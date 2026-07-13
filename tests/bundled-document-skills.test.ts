// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs"
import { spawnSync } from "node:child_process"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const integrationTest =
  process.env.ASTRAFLOW_RUN_BUNDLED_SKILL_INTEGRATION === "1"
    ? test
    : test.skip
const runtimeTarget = `${process.platform}-${process.arch}`
const pythonRoot = resolve("runtime", "python", "distributions", runtimeTarget)
const pythonExecutable =
  process.platform === "win32"
    ? join(pythonRoot, "python.exe")
    : join(pythonRoot, "bin", "python3")

function runPython(args: string[]) {
  const binDirectory =
    process.platform === "win32" ? pythonRoot : join(pythonRoot, "bin")
  const result = spawnSync(pythonExecutable, args, {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${binDirectory}${process.platform === "win32" ? ";" : ":"}${
        process.env.PATH ?? ""
      }`,
      PYTHONHOME: pythonRoot,
      PYTHONDONTWRITEBYTECODE: "1",
      PYTHONNOUSERSITE: "1",
    },
  })

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "Python command failed")
  }

  return result.stdout
}

function runNode(args: string[]) {
  const result = spawnSync(process.execPath, args, {
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_PATH: resolve("node_modules"),
    },
  })

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "Node command failed")
  }

  return result.stdout
}

describe("bundled document skills", () => {
  let outputRoot = ""

  beforeAll(() => {
    outputRoot = mkdtempSync(join(tmpdir(), "astraflow-document-skills-"))
  })

  afterAll(() => {
    rmSync(outputRoot, { recursive: true, force: true })
  })

  integrationTest(
    "creates and structurally validates PPTX, XLSX, DOCX, and PDF deliverables",
    () => {
      expect(existsSync(pythonExecutable)).toBe(true)

      const pptxOutput = join(outputRoot, "deck.pptx")
      runPython([
        "-c",
        [
          "import sys",
          "from pptx import Presentation",
          "deck = Presentation()",
          "slide = deck.slides.add_slide(deck.slide_layouts[0])",
          "slide.shapes.title.text = 'Launch review'",
          "slide.placeholders[1].text = 'July 2026'",
          "slide = deck.slides.add_slide(deck.slide_layouts[1])",
          "slide.shapes.title.text = 'Evidence'",
          "slide.placeholders[1].text = 'Activation improved'",
          "deck.save(sys.argv[1])",
        ].join("\n"),
        pptxOutput,
      ])
      runPython([
        resolve("bundled-skills/pptx/scripts/office/validate.py"),
        pptxOutput,
      ])
      expect(
        runPython(["-m", "markitdown", pptxOutput])
      ).toContain("Launch review")

      const xlsxOutput = join(outputRoot, "workbook.xlsx")
      const workbookSummary = JSON.parse(
        runPython([
          "-c",
          [
            "import json, sys",
            "from openpyxl import Workbook, load_workbook",
            "from openpyxl.chart import LineChart, Reference",
            "book = Workbook()",
            "sheet = book.active",
            "sheet.title = 'Plan'",
            "sheet.append(['Month', 'Revenue'])",
            "sheet.append(['Jan', 120000])",
            "sheet.append(['Feb', 140000])",
            "sheet['B4'] = '=SUM(B2:B3)'",
            "chart = LineChart()",
            "chart.add_data(Reference(sheet, min_col=2, min_row=1, max_row=3), titles_from_data=True)",
            "sheet.add_chart(chart, 'D2')",
            "book.save(sys.argv[1])",
            "loaded = load_workbook(sys.argv[1], data_only=False)",
            "print(json.dumps({'formula': loaded['Plan']['B4'].value, 'charts': len(loaded['Plan']._charts)}))",
          ].join("\n"),
          xlsxOutput,
        ])
      ) as { charts: number; formula: string }

      expect(workbookSummary.formula).toBe("=SUM(B2:B3)")
      expect(workbookSummary.charts).toBe(1)

      const docxOutput = join(outputRoot, "report.docx")
      runNode([
        "-e",
        [
          'const fs = require("node:fs")',
          'const { Document, HeadingLevel, Packer, Paragraph } = require("docx")',
          "const document = new Document({ sections: [{ children: [",
          '  new Paragraph({ text: "Launch report", heading: HeadingLevel.TITLE }),',
          '  new Paragraph("Activation improved in July."),',
          "] }] })",
          "Packer.toBuffer(document).then((buffer) => fs.writeFileSync(process.argv[1], buffer))",
        ].join("\n"),
        docxOutput,
      ])
      runPython([
        resolve("bundled-skills/docx/scripts/office/validate.py"),
        docxOutput,
      ])
      expect(
        runPython(["-m", "markitdown", docxOutput])
      ).toContain("Launch report")

      const pdfOutput = join(outputRoot, "report.pdf")
      const pdfSummary = JSON.parse(
        runPython([
          "-c",
          [
            "import json, sys",
            "import pdfplumber",
            "from pypdf import PdfReader",
            "from reportlab.pdfgen import canvas",
            "canvas_ = canvas.Canvas(sys.argv[1])",
            "canvas_.drawString(72, 720, 'Launch report')",
            "canvas_.save()",
            "reader = PdfReader(sys.argv[1])",
            "with pdfplumber.open(sys.argv[1]) as document:",
            "    text = document.pages[0].extract_text()",
            "print(json.dumps({'pages': len(reader.pages), 'text': text}))",
          ].join("\n"),
          pdfOutput,
        ])
      ) as { pages: number; text: string }

      expect(pdfSummary.pages).toBe(1)
      expect(pdfSummary.text).toContain("Launch report")

      const renderedPage = join(outputRoot, "page_1.png")
      runPython([
        "-c",
        [
          "import sys",
          "import pypdfium2 as pdfium",
          "document = pdfium.PdfDocument(sys.argv[1])",
          "document[0].render(scale=1.5).to_pil().save(sys.argv[2])",
        ].join("\n"),
        pdfOutput,
        renderedPage,
      ])
      expect(existsSync(renderedPage)).toBe(true)

      expect(readFileSync(pptxOutput).subarray(0, 2).toString()).toBe("PK")
      expect(readFileSync(xlsxOutput).subarray(0, 2).toString()).toBe("PK")
      expect(readFileSync(docxOutput).subarray(0, 2).toString()).toBe("PK")
      expect(readFileSync(pdfOutput).subarray(0, 4).toString()).toBe("%PDF")
      expect(
        readFileSync(renderedPage).subarray(1, 4).toString()
      ).toBe("PNG")
    },
    60_000
  )
})
