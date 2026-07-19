import { createClient } from '@supabase/supabase-js'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// ============================================================
//  Credenciais via variáveis de ambiente (.env)
//  Nunca coloque valores reais aqui — use o arquivo .env
// ============================================================
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY

const TABLE = 'ctos'
const credenciaisOk = !!SUPABASE_URL && !!SUPABASE_KEY

let sb = null
if (credenciaisOk) {
  try {
    sb = createClient(SUPABASE_URL, SUPABASE_KEY)
  } catch (e) {
    console.error('Erro ao iniciar Supabase:', e)
  }
}

// ══════════════════════════════════════
//  AUTH
// ══════════════════════════════════════
let currentTab = 'login'
let mapInitialized = false

// Exposta globalmente pois é chamada via onclick no HTML
window.switchTab = function (tab) {
  currentTab = tab
  document.getElementById('tab-login').classList.toggle('active', tab === 'login')
  document.getElementById('tab-registro').classList.toggle('active', tab === 'registro')
  document.getElementById('btn-auth-submit').textContent =
    tab === 'login' ? 'Entrar' : 'Criar conta'
  document.getElementById('auth-msg').textContent = ''
  document.getElementById('auth-msg').className = 'auth-msg'
}

function showAuthMsg(msg, type) {
  const el = document.getElementById('auth-msg')
  el.textContent = msg
  el.className = 'auth-msg ' + type
}

function translateAuthError(msg) {
  if (msg.includes('Invalid login'))           return 'Email ou senha incorretos.'
  if (msg.includes('Email not confirmed'))     return 'Confirme seu email antes de entrar.'
  if (msg.includes('User already registered')) return 'Email já cadastrado. Tente entrar.'
  if (msg.includes('Password should be'))      return 'A senha deve ter no mínimo 6 caracteres.'
  return msg
}

function showUserInfo(user) {
  const avatar = document.getElementById('user-avatar')
  const meta   = user.user_metadata
  if (meta && meta.avatar_url) {
    avatar.innerHTML = `<img src="${meta.avatar_url}" alt="avatar" />`
  } else {
    const initial = ((meta && meta.full_name) || user.email || '?')[0].toUpperCase()
    avatar.textContent = initial
  }
}

// Login com Google
document.getElementById('btn-google-login').onclick = async () => {
  if (!sb) return showAuthMsg('Credenciais do Supabase não configuradas.', 'error')
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.href },
  })
  if (error) showAuthMsg(error.message, 'error')
}

// Login / Registro com email e senha
document.getElementById('btn-auth-submit').onclick = async () => {
  if (!sb) return showAuthMsg('Credenciais do Supabase não configuradas.', 'error')

  const email = document.getElementById('auth-email').value.trim()
  const senha = document.getElementById('auth-senha').value
  const btn   = document.getElementById('btn-auth-submit')

  if (!email || !senha) return showAuthMsg('Preencha email e senha.', 'error')

  btn.disabled = true
  btn.textContent = 'Aguarde…'

  const result =
    currentTab === 'login'
      ? await sb.auth.signInWithPassword({ email, password: senha })
      : await sb.auth.signUp({ email, password: senha })

  btn.disabled = false
  btn.textContent = currentTab === 'login' ? 'Entrar' : 'Criar conta'

  if (result.error) {
    showAuthMsg(translateAuthError(result.error.message), 'error')
  } else if (currentTab === 'registro' && !(result.data && result.data.session)) {
    showAuthMsg('Conta criada! Verifique seu email para confirmar.', 'success')
  }
}

document.getElementById('auth-email').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-auth-submit').click()
})
document.getElementById('auth-senha').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-auth-submit').click()
})

if (!credenciaisOk) {
  showAuthMsg('⚠️ Configure as variáveis de ambiente no arquivo .env.', 'error')
}

// Escuta mudanças de sessão
if (sb) {
  try {
    sb.auth.onAuthStateChange((event, session) => {
      if (session) {
        document.getElementById('login-screen').style.display = 'none'
        document.getElementById('app').style.display = 'block'
        showUserInfo(session.user)
        if (!mapInitialized) {
          initMap()
          mapInitialized = true
        }
      } else {
        document.getElementById('login-screen').style.display = 'flex'
        document.getElementById('app').style.display = 'none'
      }
    })
  } catch (e) {
    console.error('Erro ao escutar auth:', e)
  }
}

document.getElementById('btn-logout').onclick = () => {
  if (sb) sb.auth.signOut()
}

// ══════════════════════════════════════
//  MAPA
// ══════════════════════════════════════
let map, markers = {}, pendingLatLng = null, tempMarker = null

function initMap() {
  map = L.map('map', { zoomControl: false }).setView([-23.55, -46.63], 14)
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 20,
  }).addTo(map)
  L.control.zoom({ position: 'bottomright' }).addTo(map)

  map.on('click', (e) => {
    if (document.getElementById('modal').style.display === 'flex') return
    pendingLatLng = e.latlng
    placeTempMarker(e.latlng)
    openModal()
  })

  loadCtos()

  document.getElementById('btn-add').onclick = () => {
    pendingLatLng = null
    if (tempMarker) { tempMarker.remove(); tempMarker = null }
    openModal()
  }

  document.getElementById('btn-gps').onclick = () => {
    if (!navigator.geolocation) return alert('GPS não disponível.')
    document.getElementById('btn-gps').classList.add('loading')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        document.getElementById('btn-gps').classList.remove('loading')
        const ll = L.latLng(pos.coords.latitude, pos.coords.longitude)
        map.flyTo(ll, 17)
        pendingLatLng = ll
        placeTempMarker(ll)
        openModal()
      },
      () => {
        document.getElementById('btn-gps').classList.remove('loading')
        alert('Não foi possível obter localização.')
      },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }
}

async function loadCtos() {
  const { data, error } = await sb.from(TABLE).select('*')
  if (error) { console.error(error.message); return }
  data.forEach((row) => addMarker(row))

  sb.channel('ctos-rt')
    .on('postgres_changes', { event: '*', schema: 'public', table: TABLE }, (payload) => {
      if (payload.eventType === 'INSERT') {
        addMarker(payload.new)
      } else if (payload.eventType === 'UPDATE') {
        removeMarker(payload.new.id)
        addMarker(payload.new)
      } else if (payload.eventType === 'DELETE') {
        removeMarker(payload.old.id)
        removeListItem(payload.old.id)
      }
    })
    .subscribe()
}

// ── Ícones ────────────────────────────────────────────────────
function makeIcon(status) {
  const colors = {
    'Ativa':          '#22c55e',
    'Em manutenção':  '#f59e0b',
    'Danificada':     '#ef4444',
    'Desconhecida':   '#6b7280',
  }
  const c = colors[status] || '#6b7280'
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 32 40">
      <path d="M16 0C7.163 0 0 7.163 0 16c0 10 16 24 16 24s16-14 16-24C32 7.163 24.837 0 16 0z"
        fill="${c}" stroke="#fff" stroke-width="2"/>
      <circle cx="16" cy="16" r="7" fill="#fff" opacity="0.9"/>
      <text x="16" y="20" text-anchor="middle" font-size="10" font-weight="bold" fill="${c}">CTO</text>
    </svg>`
  return L.divIcon({
    html: svg,
    className: '',
    iconSize: [32, 40],
    iconAnchor: [16, 40],
    popupAnchor: [0, -40],
  })
}

function addMarker(row) {
  const m = L.marker([row.lat, row.lng], { icon: makeIcon(row.status) })
    .addTo(map)
    .bindPopup(buildPopupHTML(row))
  markers[row.id] = m
  upsertListItem(row)
}

function removeMarker(id) {
  if (markers[id]) { markers[id].remove(); delete markers[id] }
}

function placeTempMarker(ll) {
  if (tempMarker) tempMarker.remove()
  tempMarker = L.circleMarker(ll, {
    radius: 8, color: '#6366f1', fillColor: '#818cf8', fillOpacity: 0.7, weight: 2,
  }).addTo(map)
}

// ── Geocodificação (Nominatim / OpenStreetMap) ────────────────
async function geocodeAddress(address) {
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1&countrycodes=br`
    const res  = await fetch(url, { headers: { 'Accept-Language': 'pt-BR' } })
    const data = await res.json()
    if (data.length > 0) return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) }
  } catch (_) {}
  return null
}

function setGeocodeMsg(msg, type) {
  const el = document.getElementById('geocode-msg')
  el.textContent = msg
  el.className   = 'geocode-msg ' + type
}

document.getElementById('btn-geocode').onclick = async () => {
  const endereco = document.getElementById('f-endereco').value.trim()
  if (!endereco) return setGeocodeMsg('Digite um endereço primeiro.', 'error')
  setGeocodeMsg('Buscando…', '')
  const coords = await geocodeAddress(endereco)
  if (coords) {
    pendingLatLng = L.latLng(coords.lat, coords.lng)
    placeTempMarker(pendingLatLng)
    map.flyTo(pendingLatLng, 17)
    setGeocodeMsg('✓ Localização encontrada!', 'success')
  } else {
    setGeocodeMsg('Endereço não encontrado. Tente ser mais específico.', 'error')
  }
}

// ── CTO: salvar, deletar, alterar status ──────────────────────
document.getElementById('form-cto').onsubmit = async (e) => {
  e.preventDefault()
  const btn      = document.getElementById('btn-salvar')
  const endereco = document.getElementById('f-endereco').value.trim()

  // Se não tem localização ainda, tenta geocodificar pelo endereço
  if (!pendingLatLng) {
    if (!endereco) return setGeocodeMsg('Clique no mapa, use o GPS ou preencha o endereço.', 'error')
    btn.disabled = true
    btn.textContent = 'Buscando endereço…'
    setGeocodeMsg('Buscando…', '')
    const coords = await geocodeAddress(endereco)
    if (!coords) {
      setGeocodeMsg('Endereço não encontrado. Ajuste o texto ou clique no mapa.', 'error')
      btn.disabled = false
      btn.textContent = 'Salvar'
      return
    }
    pendingLatLng = L.latLng(coords.lat, coords.lng)
    placeTempMarker(pendingLatLng)
    map.flyTo(pendingLatLng, 17)
  }

  btn.disabled = true
  btn.textContent = 'Salvando…'

  const { error } = await sb.from(TABLE).insert({
    endereco:  endereco,
    area_cabo: document.getElementById('f-area-cabo').value.trim(),
    sp:        document.getElementById('f-sp').value.trim(),
    sec:       document.getElementById('f-sec').value.trim(),
    status:    document.getElementById('f-status').value,
    lat:       pendingLatLng.lat,
    lng:       pendingLatLng.lng,
  })

  if (error) alert('Erro ao salvar: ' + error.message)
  else closeModal()

  btn.disabled = false
  btn.textContent = 'Salvar'
}

window.deleteCto = async (id) => {
  if (!confirm('Remover esta CTO?')) return
  await sb.from(TABLE).delete().eq('id', id)
  map.closePopup()
}

window.changeStatus = async (id, newStatus) => {
  await sb.from(TABLE).update({ status: newStatus }).eq('id', id)
  map.closePopup()
}

window.focusMarker = (id) => {
  const m = markers[id]
  if (m) {
    map.flyTo(m.getLatLng(), 18)
    setTimeout(() => m.openPopup(), 600)
    document.getElementById('painel').classList.remove('open')
  }
}

// ── Modal ─────────────────────────────────────────────────────
function openModal() {
  document.getElementById('f-endereco').value  = ''
  document.getElementById('f-area-cabo').value = ''
  document.getElementById('f-sp').value        = ''
  document.getElementById('f-sec').value       = ''
  document.getElementById('f-status').value    = 'Ativa'
  document.getElementById('modal').style.display = 'flex'
  document.getElementById('f-endereco').focus()
}

function closeModal() {
  document.getElementById('modal').style.display = 'none'
  pendingLatLng = null
  if (tempMarker) { tempMarker.remove(); tempMarker = null }
}

document.getElementById('btn-cancelar').onclick   = closeModal
document.getElementById('modal-backdrop').onclick = closeModal

// ── Popup ─────────────────────────────────────────────────────
function buildPopupHTML(row) {
  const dt   = row.criado ? new Date(row.criado).toLocaleString('pt-BR') : '—'
  const opts = ['Ativa', 'Em manutenção', 'Danificada', 'Desconhecida']
    .map((s) => `<option ${s === row.status ? 'selected' : ''}>${s}</option>`)
    .join('')
  const endereco = row.endereco
    ? `<div class="popup-meta"><span class="popup-tag">📍</span> ${escHtml(row.endereco)}</div>` : ''
  const areaCabo = row.area_cabo
    ? `<div class="popup-meta"><span class="popup-tag">ÁREA</span> ${escHtml(row.area_cabo)}</div>` : ''
  const sp  = row.sp
    ? `<div class="popup-meta"><span class="popup-tag">SP</span> ${escHtml(row.sp)}</div>` : ''
  const sec = row.sec
    ? `<div class="popup-meta"><span class="popup-tag">SEC</span> ${escHtml(row.sec)}</div>` : ''
  return `
    <div class="popup">
      <div class="popup-nome">${escHtml(row.area_cabo || 'CTO')}</div>
      ${endereco}${areaCabo}${sp}${sec}
      <div class="popup-row">
        <label>Status:</label>
        <select onchange="changeStatus('${row.id}', this.value)">${opts}</select>
      </div>
      <div class="popup-coords">${row.lat.toFixed(6)}, ${row.lng.toFixed(6)}</div>
      <div class="popup-date">${dt}</div>
      <button class="popup-del" onclick="deleteCto('${row.id}')">🗑 Remover</button>
    </div>`
}

// ── Lista lateral ─────────────────────────────────────────────
function upsertListItem(row) {
  let li = document.getElementById('li-' + row.id)
  if (!li) {
    li = document.createElement('li')
    li.id = 'li-' + row.id
    document.getElementById('lista-ctos').appendChild(li)
  }
  const colors = {
    'Ativa': '#22c55e', 'Em manutenção': '#f59e0b',
    'Danificada': '#ef4444', 'Desconhecida': '#6b7280',
  }
  const c = colors[row.status] || '#6b7280'
  li.innerHTML = `
    <div class="list-item" onclick="focusMarker('${row.id}')">
      <span class="dot" style="background:${c}"></span>
      <div class="list-info">
        <strong>${escHtml(row.area_cabo || 'CTO')}</strong>
        <small>${row.status}${row.endereco ? ' · ' + escHtml(row.endereco) : ''}${row.sp ? ' · SP ' + escHtml(row.sp) : ''}</small>
      </div>
      <span class="list-arrow">›</span>
    </div>`
  updateCount()
}

function removeListItem(id) {
  const li = document.getElementById('li-' + id)
  if (li) li.remove()
  updateCount()
}

function updateCount() {
  const n   = document.querySelectorAll('#lista-ctos li').length
  const txt = n + ' CTO' + (n !== 1 ? 's' : '')
  document.getElementById('cto-count').textContent       = txt
  document.getElementById('cto-count-badge').textContent = txt
}

function escHtml(s) {
  if (!s) return ''
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ── Painel lateral ────────────────────────────────────────────
document.getElementById('btn-lista').onclick = () =>
  document.getElementById('painel').classList.toggle('open')
document.getElementById('btn-fechar-painel').onclick = () =>
  document.getElementById('painel').classList.remove('open')