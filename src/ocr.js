import { createWorker } from 'tesseract.js'

let worker = null
let workerReady = false

async function getWorker(onProgress) {
  if (worker && workerReady) return worker

  // Destrói worker corrompido se existir
  if (worker && !workerReady) {
    try { await worker.terminate() } catch (_) {}
    worker = null
  }

  onProgress?.('Baixando OCR (1ª vez ~3MB)…')

  worker = await createWorker('eng', 1, {
    workerPath: 'https://unpkg.com/tesseract.js@5/dist/worker.min.js',
    langPath:   'https://tessdata.projectnaptha.com/4.0.0_fast',
    corePath:   'https://unpkg.com/tesseract.js-core@5/tesseract-core-simd-lstm.wasm.js',
    logger: (m) => {
      if (m.status === 'loading tesseract core') onProgress?.('Carregando motor OCR…')
      if (m.status === 'initializing tesseract') onProgress?.('Inicializando…')
      if (m.status === 'loading language traineddata') {
        const pct = m.progress ? Math.round(m.progress * 100) : 0
        onProgress?.(`Baixando dados de idioma… ${pct}%`)
      }
      if (m.status === 'recognizing text') {
        const pct = m.progress ? Math.round(m.progress * 100) : 0
        onProgress?.(`Lendo etiqueta… ${pct}%`)
      }
    },
  })

  await worker.setParameters({
    tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789:.- ',
    tessedit_pageseg_mode:   '6', // assume bloco uniforme de texto
  })

  workerReady = true
  return worker
}

// Extrai informações de uma CTO a partir de texto OCR
function parseCtoText(text) {
  const t = text.toUpperCase().replace(/\n/g, ' ').replace(/\s+/g, ' ')
  const result = {}

  // Área/Cabo: 2-5 letras seguidas de 2-3 dígitos (ex: IPFH01, JDPA02, CTO01)
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
  const w = await getWorker(onProgress)

  onProgress?.('Analisando imagem…')
  const { data } = await w.recognize(imageFile)

  onProgress?.('Extraindo dados…')
  const parsed = parseCtoText(data.text)
  parsed._rawText = data.text
  return parsed
}

// Libera memória quando não em uso (chamado ao fechar o modal)
export async function disposeWorker() {
  if (worker) {
    try { await worker.terminate() } catch (_) {}
    worker = null
    workerReady = false
  }
}
