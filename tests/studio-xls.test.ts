// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { describe, expect, test } from "bun:test"

import { parseLegacyXls, parseLegacyXlsWorkbookStream } from "@/lib/studio-xls"

function concatBytes(...parts: Uint8Array[]) {
  const result = new Uint8Array(
    parts.reduce((total, part) => total + part.byteLength, 0)
  )
  let offset = 0

  for (const part of parts) {
    result.set(part, offset)
    offset += part.byteLength
  }

  return result
}

function record(id: number, payload = new Uint8Array()) {
  const bytes = new Uint8Array(payload.byteLength + 4)
  const view = new DataView(bytes.buffer)
  view.setUint16(0, id, true)
  view.setUint16(2, payload.byteLength, true)
  bytes.set(payload, 4)
  return bytes
}

function bof(type: number) {
  const payload = new Uint8Array(4)
  const view = new DataView(payload.buffer)
  view.setUint16(0, 0x0600, true)
  view.setUint16(2, type, true)
  return record(0x0809, payload)
}

function createWorkbookStream() {
  const globalBof = bof(0x0005)
  const boundSheetPayload = new Uint8Array(13)
  boundSheetPayload[5] = 0
  boundSheetPayload[6] = 5
  boundSheetPayload[7] = 0
  boundSheetPayload.set(new TextEncoder().encode("Sheet"), 8)
  const boundSheet = record(0x0085, boundSheetPayload)
  const globalEof = record(0x000a)
  const sheetOffset =
    globalBof.byteLength + boundSheet.byteLength + globalEof.byteLength
  new DataView(boundSheetPayload.buffer).setUint32(0, sheetOffset, true)
  const correctedBoundSheet = record(0x0085, boundSheetPayload)

  const labelPayload = new Uint8Array(13)
  const labelView = new DataView(labelPayload.buffer)
  labelView.setUint16(0, 0, true)
  labelView.setUint16(2, 0, true)
  labelView.setUint16(4, 0, true)
  labelView.setUint16(6, 4, true)
  labelPayload[8] = 0
  labelPayload.set(new TextEncoder().encode("Name"), 9)

  const numberPayload = new Uint8Array(14)
  const numberView = new DataView(numberPayload.buffer)
  numberView.setUint16(0, 1, true)
  numberView.setUint16(2, 0, true)
  numberView.setFloat64(6, 42.5, true)

  return concatBytes(
    globalBof,
    correctedBoundSheet,
    globalEof,
    bof(0x0010),
    record(0x0204, labelPayload),
    record(0x0203, numberPayload),
    record(0x000a)
  )
}

function createSparseWorkbookStream() {
  const workbook = createWorkbookStream()
  const numberRecordId = new Uint8Array([0x03, 0x02, 0x0e, 0x00])
  const recordOffset = workbook.findIndex(
    (value, index) =>
      value === numberRecordId[0] &&
      workbook[index + 1] === numberRecordId[1] &&
      workbook[index + 2] === numberRecordId[2] &&
      workbook[index + 3] === numberRecordId[3]
  )

  new DataView(workbook.buffer).setUint16(recordOffset + 4, 2, true)
  return workbook
}

function createCompoundXls(workbook: Uint8Array) {
  const sectorSize = 512
  const workbookSectorCount = 8
  const bytes = new Uint8Array((3 + workbookSectorCount) * sectorSize)
  const view = new DataView(bytes.buffer)
  bytes.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
  view.setUint16(24, 0x003e, true)
  view.setUint16(26, 0x0003, true)
  view.setUint16(28, 0xfffe, true)
  view.setUint16(30, 9, true)
  view.setUint16(32, 6, true)
  view.setUint32(44, 1, true)
  view.setUint32(48, 1, true)
  view.setUint32(56, 4096, true)
  view.setUint32(60, 0xfffffffe, true)
  view.setUint32(68, 0xfffffffe, true)
  view.setUint32(76, 0, true)

  for (let index = 1; index < 109; index += 1) {
    view.setUint32(76 + index * 4, 0xffffffff, true)
  }

  const fatOffset = sectorSize

  for (let index = 0; index < sectorSize / 4; index += 1) {
    view.setUint32(fatOffset + index * 4, 0xffffffff, true)
  }

  view.setUint32(fatOffset, 0xfffffffd, true)
  view.setUint32(fatOffset + 4, 0xfffffffe, true)

  for (let sector = 2; sector < 2 + workbookSectorCount; sector += 1) {
    view.setUint32(
      fatOffset + sector * 4,
      sector === 1 + workbookSectorCount ? 0xfffffffe : sector + 1,
      true
    )
  }

  const directoryOffset = sectorSize * 2

  function writeDirectoryEntry(
    offset: number,
    name: string,
    type: number,
    startSector: number,
    size: number
  ) {
    const nameBytes = new Uint8Array((name.length + 1) * 2)

    for (let index = 0; index < name.length; index += 1) {
      nameBytes[index * 2] = name.charCodeAt(index)
    }

    bytes.set(nameBytes, offset)
    view.setUint16(offset + 64, nameBytes.length, true)
    bytes[offset + 66] = type
    bytes[offset + 67] = 1
    view.setUint32(offset + 116, startSector, true)
    view.setUint32(offset + 120, size, true)
  }

  writeDirectoryEntry(directoryOffset, "Root Entry", 5, 0xfffffffe, 0)
  writeDirectoryEntry(directoryOffset + 128, "Workbook", 2, 2, 4096)
  bytes.set(workbook, sectorSize * 3)
  return bytes
}

describe("legacy XLS preview", () => {
  test("decodes text and numeric cells from a BIFF8 worksheet", () => {
    expect(parseLegacyXlsWorkbookStream(createWorkbookStream()).rows).toEqual([
      ["Name"],
      ["42.5"],
    ])
  })

  test("extracts the Workbook stream from a compound XLS file", () => {
    expect(
      parseLegacyXls(createCompoundXls(createWorkbookStream())).rows
    ).toEqual([["Name"], ["42.5"]])
  })

  test("preserves blank worksheet rows without producing sparse arrays", () => {
    expect(parseLegacyXlsWorkbookStream(createSparseWorkbookStream()).rows).toEqual(
      [["Name"], [], ["42.5"]]
    )
  })
})
