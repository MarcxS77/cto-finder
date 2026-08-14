import { createWorker } from 'tesseract.js'

let worker = null

async function getWorker() {
  if (worker) return worker
  worker = await createWorker('por+eng', 1, {
    workerPath: 'https://unpkg.com/tesseract.js@5/dist/worker.min.js',
    langPath:   'https://tessdata.projectnaptha.com/4.0.0',
    corePath:   'https://unpkg.com/tesseract.js-core@5/tesseract-core-simd-lstm.wasm.js',
    logger:     () => {},
  })
  await worker.setParameters({
    tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789:.- ',
  })
  return worker
}

// Extrai informações de uma CTO a partir de texto OCR
function parseCtoText(text) {
  const t   = text.toUpperCase().replace(/\n/g, ' ').replace(/\s+/g, ' ')
  const result = {}

  // Area/Cabo: sequência de 2-5 letras seguidas de 2-3 números (ex: IPFH01, JDPA02, CTO01)
  const areaMatch = t.match(/\b([A-Z]{2,5}\d{2,3})\b/)
  if (areaMatch) result.area_cabo = areaMatch[1]

  // SP: número após "SP" com separador opcional (ex: SP: 01, SP01, SP 01)
  const spMatch = t.match(/\bSP[\s:.-]*(\d{1,3})\b/)
  if (spMatch) result.sp = spMatch[1].replace(/^0+/, '') || '0'

  // SEC: intervalo após "SEC" (ex: SEC: 01-08, SEC01-08)
  const secMatch = t.match(/\bSEC[\s:.-]*(\d{1,2}[-–]\d{1,2})\b/)
  if (secMatch) result.sec = secMatch[1]

  return result
}

export async function scanCtoLabel(imageFile, onProgress) {
  const w = await getWorker()

  onProgress?.('Analisando imagem…')
  const { data } = await w.recognize(imageFile)

  onProgress?.('Extraindo dados…')
  const parsed = parseCtoText(data.text)
  parsed._rawText = data.text

  return parsed
}
