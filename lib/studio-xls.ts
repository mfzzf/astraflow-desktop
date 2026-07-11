const CFB_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]
const CFB_FREE_SECTOR = 0xffffffff
const CFB_END_OF_CHAIN = 0xfffffffe
const MAX_XLS_STREAM_BYTES = 12 * 1024 * 1024
const MAX_CFB_DIRECTORY_BYTES = 8 * 1024 * 1024
const MAX_CFB_CHAIN_SECTORS = 65_536
const MAX_BIFF_RECORDS = 250_000

type CfbDirectoryEntry = {
  name: string
  type: number
  startSector: number
  size: number
}

type BiffRecord = {
  id: number
  offset: number
  length: number
}

export type LegacyXlsPreview = {
  rows: string[][]
}

function assertRange(
  bytes: Uint8Array,
  offset: number,
  length: number,
  message: string
) {
  if (offset < 0 || length < 0 || offset + length > bytes.byteLength) {
    throw new Error(message)
  }
}

function getUint16(bytes: Uint8Array, offset: number) {
  assertRange(bytes, offset, 2, "XLS data is truncated")
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 2).getUint16(
    0,
    true
  )
}

function getUint32(bytes: Uint8Array, offset: number) {
  assertRange(bytes, offset, 4, "XLS data is truncated")
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(
    0,
    true
  )
}

function getFloat64(bytes: Uint8Array, offset: number) {
  assertRange(bytes, offset, 8, "XLS number is truncated")
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 8).getFloat64(
    0,
    true
  )
}

function concatenateChunks(chunks: Uint8Array[], size: number) {
  const result = new Uint8Array(size)
  let offset = 0

  for (const chunk of chunks) {
    const remaining = size - offset

    if (remaining <= 0) {
      break
    }

    const slice = chunk.subarray(0, remaining)
    result.set(slice, offset)
    offset += slice.byteLength
  }

  return offset === size ? result : result.slice(0, offset)
}

function parseCfbWorkbookStream(bytes: Uint8Array) {
  assertRange(bytes, 0, 512, "XLS compound-file header is missing")

  if (!CFB_MAGIC.every((value, index) => bytes[index] === value)) {
    throw new Error("XLS is not a Compound File Binary document")
  }

  if (getUint16(bytes, 28) !== 0xfffe) {
    throw new Error("XLS byte order is unsupported")
  }

  const sectorSize = 2 ** getUint16(bytes, 30)
  const miniSectorSize = 2 ** getUint16(bytes, 32)
  const fatSectorCount = getUint32(bytes, 44)
  const firstDirectorySector = getUint32(bytes, 48)
  const miniStreamCutoff = getUint32(bytes, 56)
  const firstMiniFatSector = getUint32(bytes, 60)
  const miniFatSectorCount = getUint32(bytes, 64)
  const firstDifatSector = getUint32(bytes, 68)
  const difatSectorCount = getUint32(bytes, 72)

  if (
    ![512, 4096].includes(sectorSize) ||
    miniSectorSize !== 64 ||
    fatSectorCount > MAX_CFB_CHAIN_SECTORS
  ) {
    throw new Error("XLS compound-file layout is unsupported")
  }

  const sectorCount = Math.floor(bytes.byteLength / sectorSize) - 1

  function readSector(sectorId: number) {
    if (sectorId < 0 || sectorId >= sectorCount) {
      throw new Error("XLS sector points outside the file")
    }

    const offset = (sectorId + 1) * sectorSize
    return bytes.subarray(offset, offset + sectorSize)
  }

  const difat: number[] = []

  for (let index = 0; index < 109; index += 1) {
    const sectorId = getUint32(bytes, 76 + index * 4)

    if (sectorId !== CFB_FREE_SECTOR) {
      difat.push(sectorId)
    }
  }

  let difatSector = firstDifatSector
  const visitedDifat = new Set<number>()

  for (let index = 0; index < difatSectorCount; index += 1) {
    if (difatSector === CFB_END_OF_CHAIN || visitedDifat.has(difatSector)) {
      break
    }

    visitedDifat.add(difatSector)
    const sector = readSector(difatSector)
    const entriesPerSector = sectorSize / 4 - 1

    for (let entry = 0; entry < entriesPerSector; entry += 1) {
      const sectorId = getUint32(sector, entry * 4)

      if (sectorId !== CFB_FREE_SECTOR) {
        difat.push(sectorId)
      }
    }

    difatSector = getUint32(sector, sectorSize - 4)
  }

  if (difat.length < fatSectorCount) {
    throw new Error("XLS allocation table is incomplete")
  }

  const fat: number[] = []

  for (const sectorId of difat.slice(0, fatSectorCount)) {
    const sector = readSector(sectorId)

    for (let offset = 0; offset < sectorSize; offset += 4) {
      fat.push(getUint32(sector, offset))
    }
  }

  function readRegularChain(
    startSector: number,
    requestedSize: number,
    maximumSize: number
  ) {
    if (requestedSize > maximumSize) {
      throw new Error("XLS stream exceeds the preview safety limit")
    }

    const chunks: Uint8Array[] = []
    const visited = new Set<number>()
    let sectorId = startSector
    let totalSize = 0

    while (
      sectorId !== CFB_END_OF_CHAIN &&
      sectorId !== CFB_FREE_SECTOR &&
      chunks.length < MAX_CFB_CHAIN_SECTORS
    ) {
      if (visited.has(sectorId) || sectorId >= fat.length) {
        throw new Error("XLS allocation chain is invalid")
      }

      visited.add(sectorId)
      const sector = readSector(sectorId)
      chunks.push(sector)
      totalSize += sector.byteLength

      if (totalSize > maximumSize + sectorSize) {
        throw new Error("XLS stream exceeds the preview safety limit")
      }

      if (requestedSize > 0 && totalSize >= requestedSize) {
        break
      }

      sectorId = fat[sectorId]
    }

    const outputSize = requestedSize > 0 ? requestedSize : totalSize
    return concatenateChunks(chunks, Math.min(outputSize, totalSize))
  }

  const directoryBytes = readRegularChain(
    firstDirectorySector,
    0,
    MAX_CFB_DIRECTORY_BYTES
  )
  const directory: CfbDirectoryEntry[] = []

  for (let offset = 0; offset + 128 <= directoryBytes.length; offset += 128) {
    const nameBytes = Math.min(getUint16(directoryBytes, offset + 64), 64)
    const type = directoryBytes[offset + 66]

    if (nameBytes < 2 || type === 0) {
      continue
    }

    const name = new TextDecoder("utf-16le")
      .decode(directoryBytes.subarray(offset, offset + nameBytes - 2))
      .replace(/\0/g, "")
    const sizeLow = getUint32(directoryBytes, offset + 120)
    const sizeHigh = getUint32(directoryBytes, offset + 124)
    const size = sizeLow + sizeHigh * 2 ** 32

    if (!Number.isSafeInteger(size)) {
      throw new Error("XLS stream size is unsupported")
    }

    directory.push({
      name,
      type,
      startSector: getUint32(directoryBytes, offset + 116),
      size,
    })
  }

  const root = directory.find((entry) => entry.type === 5)
  const workbook = directory.find(
    (entry) => entry.type === 2 && /^(workbook|book)$/i.test(entry.name)
  )

  if (!root || !workbook || workbook.size <= 0) {
    throw new Error("XLS Workbook stream is missing")
  }

  if (workbook.size >= miniStreamCutoff) {
    return readRegularChain(
      workbook.startSector,
      workbook.size,
      MAX_XLS_STREAM_BYTES
    )
  }

  const miniStream = readRegularChain(
    root.startSector,
    root.size,
    MAX_XLS_STREAM_BYTES
  )
  const miniFatBytes = readRegularChain(
    firstMiniFatSector,
    miniFatSectorCount * sectorSize,
    MAX_CFB_DIRECTORY_BYTES
  )
  const miniFat: number[] = []

  for (let offset = 0; offset + 4 <= miniFatBytes.length; offset += 4) {
    miniFat.push(getUint32(miniFatBytes, offset))
  }

  const chunks: Uint8Array[] = []
  const visitedMiniSectors = new Set<number>()
  let miniSectorId = workbook.startSector
  let totalSize = 0

  while (
    miniSectorId !== CFB_END_OF_CHAIN &&
    miniSectorId !== CFB_FREE_SECTOR &&
    totalSize < workbook.size
  ) {
    if (
      miniSectorId >= miniFat.length ||
      visitedMiniSectors.has(miniSectorId)
    ) {
      throw new Error("XLS mini-stream allocation chain is invalid")
    }

    visitedMiniSectors.add(miniSectorId)
    const offset = miniSectorId * miniSectorSize
    assertRange(
      miniStream,
      offset,
      miniSectorSize,
      "XLS mini stream is truncated"
    )
    chunks.push(miniStream.subarray(offset, offset + miniSectorSize))
    totalSize += miniSectorSize
    miniSectorId = miniFat[miniSectorId]
  }

  return concatenateChunks(chunks, workbook.size)
}

function collectBiffRecords(bytes: Uint8Array) {
  const records: BiffRecord[] = []
  let offset = 0

  while (offset + 4 <= bytes.length && records.length < MAX_BIFF_RECORDS) {
    const id = getUint16(bytes, offset)
    const length = getUint16(bytes, offset + 2)
    const payloadOffset = offset + 4

    if (payloadOffset + length > bytes.length) {
      break
    }

    records.push({ id, offset: payloadOffset, length })
    offset = payloadOffset + length
  }

  return records
}

class SegmentedBiffCursor {
  private segmentIndex = 0
  private offset = 0

  constructor(private readonly segments: Uint8Array[]) {}

  private moveToNextSegment() {
    this.segmentIndex += 1
    this.offset = 0

    if (this.segmentIndex >= this.segments.length) {
      throw new Error("XLS shared strings are truncated")
    }
  }

  readByte() {
    while (this.offset >= this.segments[this.segmentIndex].length) {
      this.moveToNextSegment()
    }

    return this.segments[this.segmentIndex][this.offset++]
  }

  readUint16() {
    return this.readByte() | (this.readByte() << 8)
  }

  readUint32() {
    return (
      (this.readByte() |
        (this.readByte() << 8) |
        (this.readByte() << 16) |
        (this.readByte() << 24)) >>>
      0
    )
  }

  skip(length: number) {
    for (let index = 0; index < length; index += 1) {
      this.readByte()
    }
  }

  readCharacters(length: number, highByte: boolean) {
    let output = ""
    let wide = highByte

    for (let index = 0; index < length; index += 1) {
      const requiredBytes = wide ? 2 : 1
      const remainingBytes =
        this.segments[this.segmentIndex].length - this.offset

      if (remainingBytes < requiredBytes) {
        this.moveToNextSegment()
        wide = (this.readByte() & 0x01) !== 0
      }

      const codePoint = wide
        ? this.readByte() | (this.readByte() << 8)
        : this.readByte()
      output += String.fromCharCode(codePoint)
    }

    return output
  }
}

function parseSharedStrings(
  bytes: Uint8Array,
  records: BiffRecord[],
  recordIndex: number
) {
  const segments = [
    bytes.subarray(
      records[recordIndex].offset,
      records[recordIndex].offset + records[recordIndex].length
    ),
  ]

  for (let index = recordIndex + 1; records[index]?.id === 0x003c; index += 1) {
    const record = records[index]
    segments.push(bytes.subarray(record.offset, record.offset + record.length))
  }

  const cursor = new SegmentedBiffCursor(segments)
  cursor.readUint32()
  const uniqueStringCount = Math.min(cursor.readUint32(), 200_000)
  const strings: string[] = []

  for (let index = 0; index < uniqueStringCount; index += 1) {
    const characterCount = cursor.readUint16()
    const flags = cursor.readByte()
    const runCount = flags & 0x08 ? cursor.readUint16() : 0
    const extensionSize = flags & 0x04 ? cursor.readUint32() : 0
    strings.push(cursor.readCharacters(characterCount, (flags & 0x01) !== 0))
    cursor.skip(runCount * 4 + extensionSize)
  }

  return strings
}

function decodeBiffString(
  bytes: Uint8Array,
  offset: number,
  byteLength: number
) {
  if (byteLength < 3) {
    return ""
  }

  const characterCount = getUint16(bytes, offset)
  const flags = bytes[offset + 2]
  const wide = (flags & 0x01) !== 0
  const start = offset + 3
  const length = Math.min(characterCount * (wide ? 2 : 1), byteLength - 3)

  return new TextDecoder(wide ? "utf-16le" : "windows-1252").decode(
    bytes.subarray(start, start + length)
  )
}

function decodeRkNumber(raw: number) {
  let value: number

  if (raw & 0x02) {
    value = raw >> 2
  } else {
    const buffer = new ArrayBuffer(8)
    const view = new DataView(buffer)
    view.setUint32(0, 0, true)
    view.setUint32(4, raw & 0xfffffffc, true)
    value = view.getFloat64(0, true)
  }

  return raw & 0x01 ? value / 100 : value
}

function formatBiffValue(value: number) {
  return Number.isFinite(value) ? String(value) : ""
}

export function parseLegacyXlsWorkbookStream(
  bytes: Uint8Array,
  maxRows = 200,
  maxColumns = 50
): LegacyXlsPreview {
  const records = collectBiffRecords(bytes)

  if (records.some((record) => record.id === 0x002f)) {
    throw new Error("Password-protected XLS files are not previewed")
  }

  const sstIndex = records.findIndex((record) => record.id === 0x00fc)
  const sharedStrings =
    sstIndex >= 0 ? parseSharedStrings(bytes, records, sstIndex) : []
  const boundSheets = records
    .filter((record) => record.id === 0x0085 && record.length >= 8)
    .map((record) => ({
      offset: getUint32(bytes, record.offset),
      type: bytes[record.offset + 5],
    }))
  const firstWorksheet = boundSheets.find((sheet) => sheet.type === 0)
  let sheetOffset = firstWorksheet?.offset ?? -1

  if (sheetOffset < 0) {
    const worksheetBof = records.find(
      (record) =>
        [0x0009, 0x0209, 0x0409, 0x0809].includes(record.id) &&
        record.length >= 4 &&
        getUint16(bytes, record.offset + 2) === 0x0010
    )
    sheetOffset = worksheetBof ? worksheetBof.offset - 4 : -1
  }

  if (sheetOffset < 0 || sheetOffset >= bytes.length) {
    throw new Error("XLS worksheet is missing")
  }

  const rows: string[][] = []
  let offset = sheetOffset
  let recordCount = 0
  let lastStringFormulaCell: { row: number; column: number } | null = null

  function setCell(row: number, column: number, value: string) {
    if (row >= maxRows || column >= maxColumns || row < 0 || column < 0) {
      return
    }

    rows[row] ??= []
    rows[row][column] = value
  }

  while (offset + 4 <= bytes.length && recordCount < MAX_BIFF_RECORDS) {
    const id = getUint16(bytes, offset)
    const length = getUint16(bytes, offset + 2)
    const payload = offset + 4

    if (payload + length > bytes.length) {
      break
    }

    recordCount += 1

    if (id === 0x000a && offset > sheetOffset) {
      break
    }

    if (length >= 6) {
      const row = getUint16(bytes, payload)
      const column = getUint16(bytes, payload + 2)

      if (id === 0x0203 && length >= 14) {
        setCell(row, column, formatBiffValue(getFloat64(bytes, payload + 6)))
      } else if (id === 0x00fd && length >= 10) {
        const stringIndex = getUint32(bytes, payload + 6)
        setCell(row, column, sharedStrings[stringIndex] ?? "")
      } else if (id === 0x027e && length >= 10) {
        setCell(
          row,
          column,
          formatBiffValue(decodeRkNumber(getUint32(bytes, payload + 6)))
        )
      } else if (id === 0x00bd && length >= 12) {
        const firstColumn = column
        const lastColumn = getUint16(bytes, payload + length - 2)

        for (
          let currentColumn = firstColumn;
          currentColumn <= lastColumn;
          currentColumn += 1
        ) {
          const recordOffset = payload + 4 + (currentColumn - firstColumn) * 6

          if (recordOffset + 6 > payload + length - 2) {
            break
          }

          setCell(
            row,
            currentColumn,
            formatBiffValue(decodeRkNumber(getUint32(bytes, recordOffset + 2)))
          )
        }
      } else if (id === 0x0205 && length >= 8) {
        const isError = bytes[payload + 7] !== 0
        setCell(
          row,
          column,
          isError ? "#ERROR" : bytes[payload + 6] ? "TRUE" : "FALSE"
        )
      } else if (id === 0x0204 && length >= 9) {
        setCell(row, column, decodeBiffString(bytes, payload + 6, length - 6))
      } else if (id === 0x0006 && length >= 14) {
        const specialResult =
          bytes[payload + 12] === 0xff && bytes[payload + 13] === 0xff

        if (specialResult) {
          const resultType = bytes[payload + 6]

          if (resultType === 0) {
            lastStringFormulaCell = { row, column }
          } else if (resultType === 1) {
            setCell(row, column, bytes[payload + 8] ? "TRUE" : "FALSE")
          } else if (resultType === 2) {
            setCell(row, column, "#ERROR")
          }
        } else {
          setCell(row, column, formatBiffValue(getFloat64(bytes, payload + 6)))
        }
      }
    }

    if (id === 0x0207 && lastStringFormulaCell) {
      setCell(
        lastStringFormulaCell.row,
        lastStringFormulaCell.column,
        decodeBiffString(bytes, payload, length)
      )
      lastStringFormulaCell = null
    }

    offset = payload + length
  }

  return {
    rows: Array.from(
      { length: Math.min(rows.length, maxRows) },
      (_, index) => (rows[index] ?? []).slice(0, maxColumns)
    ),
  }
}

export function parseLegacyXls(
  bytes: Uint8Array,
  maxRows = 200,
  maxColumns = 50
) {
  return parseLegacyXlsWorkbookStream(
    parseCfbWorkbookStream(bytes),
    maxRows,
    maxColumns
  )
}
