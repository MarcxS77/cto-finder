import { createClient } from '@supabase/supabase-js'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY  = import.meta.env.VITE_SUPABASE_KEY
const ADMIN_EMAILS  = ['marcosviniciiusz77@gmail.com', 'marcos.pbeng@gmail.com']
const TABLE         = 'ctos'
const credenciaisOk = !!SUPABASE_URL && !!SUPABASE_KEY

let sb = null
if (credenciaisOk) {
  try { sb = createClient(SUPABASE_URL, SUPABASE_KEY) }
  catch (e) { console.error('Erro ao iniciar Supabase:', e) }
}

// ══════════════════════════════════════
//  AUTH
// ══════════════════════════════════════
let currentTab      = 'login'
let mapInitialized  = false
let currentUser     = null
let isAdmin         = false

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

document.getElementById('btn-google-login').onclick = async () => {
  if (!sb) return showAuthMsg('Credenciais do Supabase não configuradas.', 'error')
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.href },
  })
  if (error) showAuthMsg(error.message, 'error')
}

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
  if (result.error) showAuthMsg(translateAuthError(result.error.message), 'error')
  else if (currentTab === 'registro' && !(result.data && result.data.session))
    showAuthMsg('Conta criada! Verifique seu email para confirmar.', 'success')
}

document.getElementById('auth-email').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-auth-submit').click()
})
document.getElementById('auth-senha').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-auth-submit').click()
})

if (!credenciaisOk) showAuthMsg('⚠️ Configure as variáveis de ambiente no arquivo .env.', 'error')

function handleSession(session) {
  document.getElementById('loading-screen').style.display = 'none'
  if (session) {
    currentUser = session.user
    isAdmin     = ADMIN_EMAILS.includes(currentUser.email)
    document.getElementById('login-screen').style.display = 'none'
    document.getElementById('app').style.display = 'block'
    showUserInfo(currentUser)
    if (isAdmin) {
      document.getElementById('btn-pendentes').style.display = 'flex'
      document.getElementById('admin-badge-wrap').style.display = 'block'
    }
    if (!mapInitialized) { initMap(); mapInitialized = true }
  } else {
    currentUser = null
    isAdmin     = false
    document.getElementById('login-screen').style.display = 'flex'
    document.getElementById('app').style.display = 'none'
  }
}

if (sb) {
  // Detecta se há código OAuth na URL (redirect do Google)
  const temCodigoOAuth = new URLSearchParams(window.location.search).has('code')

  sb.auth.onAuthStateChange((event, session) => {
    // Se veio de redirect OAuth e ainda não temos sessão, aguarda a troca do código
    if (event === 'INITIAL_SESSION' && !session && temCodigoOAuth) return
    handleSession(session)
  })
}

document.getElementById('btn-logout').onclick = () => { if (sb) sb.auth.signOut() }

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

  document.getElementById('btn-pendentes').onclick = () =>
    document.getElementById('painel-admin').classList.toggle('open')
  document.getElementById('btn-fechar-admin').onclick = () =>
    document.getElementById('painel-admin').classList.remove('open')
}

async function loadCtos() {
  // Admin vê tudo; usuários comuns veem só aprovadas
  let query = sb.from(TABLE).select('*')
  if (!isAdmin) query = query.eq('status_aprovacao', 'aprovado')
  const { data, error } = await query
  if (error) { console.error(error.message); return }

  data.forEach((row) => {
    if (row.status_aprovacao === 'aprovado') addMarker(row)
    else if (isAdmin) addMarkerPendente(row)
  })
  if (isAdmin) updatePendenteCount()

  sb.channel('ctos-rt')
    .on('postgres_changes', { event: '*', schema: 'public', table: TABLE }, (payload) => {
      const row = payload.new || payload.old

      if (payload.eventType === 'INSERT') {
        if (row.status_aprovacao === 'aprovado') {
          addMarker(row)
        } else if (isAdmin) {
          addMarkerPendente(row)
          upsertPendenteItem(row)
          updatePendenteCount()
        }
      } else if (payload.eventType === 'UPDATE') {
        removeMarker(row.id)
        removeListItem(row.id)
        removePendenteItem(row.id)
        if (row.status_aprovacao === 'aprovado') {
          addMarker(row)
        } else if (isAdmin && row.status_aprovacao === 'pendente') {
          addMarkerPendente(row)
        }
        updatePendenteCount()
      } else if (payload.eventType === 'DELETE') {
        removeMarker(row.id)
        removeListItem(row.id)
        removePendenteItem(row.id)
        updatePendenteCount()
      }
    })
    .subscribe()
}

// ── Ícones ────────────────────────────────────────────────────
function makeIcon(status) {
  const colors = {
    'Ativa': '#22c55e', 'Em manutenção': '#f59e0b',
    'Danificada': '#ef4444', 'Desconhecida': '#6b7280',
  }
  const c = colors[status] || '#6b7280'
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 32 40">
      <path d="M16 0C7.163 0 0 7.163 0 16c0 10 16 24 16 24s16-14 16-24C32 7.163 24.837 0 16 0z"
        fill="${c}" stroke="#fff" stroke-width="2"/>
      <circle cx="16" cy="16" r="7" fill="#fff" opacity="0.9"/>
      <text x="16" y="20" text-anchor="middle" font-size="10" font-weight="bold" fill="${c}">CTO</text>
    </svg>`
  return L.divIcon({ html: svg, className: '', iconSize: [32, 40], iconAnchor: [16, 40], popupAnchor: [0, -40] })
}

function makeIconPendente() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 32 40">
      <path d="M16 0C7.163 0 0 7.163 0 16c0 10 16 24 16 24s16-14 16-24C32 7.163 24.837 0 16 0z"
        fill="#f59e0b" stroke="#fff" stroke-width="2"/>
      <circle cx="16" cy="16" r="7" fill="#fff" opacity="0.9"/>
      <text x="16" y="20" text-anchor="middle" font-size="9" font-weight="bold" fill="#f59e0b">?</text>
    </svg>`
  return L.divIcon({ html: `<div class="marker-pendente">${svg}</div>`, className: '', iconSize: [32, 40], iconAnchor: [16, 40], popupAnchor: [0, -40] })
}

function addMarker(row) {
  const m = L.marker([row.lat, row.lng], { icon: makeIcon(row.status) })
    .addTo(map).bindPopup(buildPopupHTML(row))
  markers[row.id] = m
  upsertListItem(row)
}

function addMarkerPendente(row) {
  const m = L.marker([row.lat, row.lng], { icon: makeIconPendente() })
    .addTo(map).bindPopup(buildPopupPendenteHTML(row))
  markers[row.id] = m
  upsertPendenteItem(row)
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

// ── Geocodificação + Autocomplete ─────────────────────────────
function setGeocodeMsg(msg, type) {
  const el = document.getElementById('geocode-msg')
  el.textContent = msg
  el.className   = 'geocode-msg ' + (type || '')
}

function hideAutocomplete() {
  const list = document.getElementById('autocomplete-list')
  if (list) { list.innerHTML = ''; list.style.display = 'none' }
}

function showAutocomplete(results) {
  const list = document.getElementById('autocomplete-list')
  list.innerHTML = ''
  if (!results.length) { list.style.display = 'none'; return }
  results.forEach((r) => {
    const addr   = r.address || {}
    const bairro = addr.suburb || addr.neighbourhood || addr.city_district || addr.quarter || ''
    const rua    = addr.road || addr.pedestrian || addr.path || r.display_name.split(',')[0]
    const cidade = addr.city || addr.town || addr.village || ''
    const item   = document.createElement('div')
    item.className = 'autocomplete-item'
    item.innerHTML = `
      <div class="ac-rua">${escHtml(rua)}</div>
      <div class="ac-bairro">${escHtml([bairro, cidade].filter(Boolean).join(' · '))}</div>`
    item.onmousedown = (e) => {
      e.preventDefault()
      document.getElementById('f-endereco').value = rua
      document.getElementById('f-bairro').value   = bairro
      pendingLatLng = L.latLng(parseFloat(r.lat), parseFloat(r.lon))
      placeTempMarker(pendingLatLng)
      map.flyTo(pendingLatLng, 17)
      hideAutocomplete()
      setGeocodeMsg('✓ Localização definida — ' + (bairro || cidade), 'success')
    }
    list.appendChild(item)
  })
  list.style.display = 'block'
}

let acTimer = null
document.getElementById('f-endereco').addEventListener('input', () => {
  clearTimeout(acTimer)
  const val = document.getElementById('f-endereco').value.trim()
  if (val.length < 4) return hideAutocomplete()
  acTimer = setTimeout(async () => {
    try {
      const bairroHint = document.getElementById('f-bairro').value.trim()
      const query = [val, bairroHint].filter(Boolean).join(', ')
      const url   = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=6&countrycodes=br&addressdetails=1`
      const res   = await fetch(url, { headers: { 'Accept-Language': 'pt-BR' } })
      const data  = await res.json()
      showAutocomplete(data)
    } catch (_) {}
  }, 400)
})
document.getElementById('f-endereco').addEventListener('blur', () => setTimeout(hideAutocomplete, 150))

async function geocodeAddress(endereco, bairro) {
  try {
    const query = [endereco, bairro].filter(Boolean).join(', ')
    const url   = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1&countrycodes=br`
    const res   = await fetch(url, { headers: { 'Accept-Language': 'pt-BR' } })
    const data  = await res.json()
    if (data.length > 0) return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) }
  } catch (_) {}
  return null
}

// ── Salvar CTO ────────────────────────────────────────────────
document.getElementById('form-cto').onsubmit = async (e) => {
  e.preventDefault()
  const btn      = document.getElementById('btn-salvar')
  const endereco = document.getElementById('f-endereco').value.trim()
  const bairro   = document.getElementById('f-bairro').value.trim()

  if (!pendingLatLng) {
    if (!endereco && !bairro) return setGeocodeMsg('Selecione um endereço na lista ou clique no mapa.', 'error')
    btn.disabled = true; btn.textContent = 'Buscando…'
    setGeocodeMsg('Buscando localização…', '')
    const coords = await geocodeAddress(endereco, bairro)
    if (!coords) {
      setGeocodeMsg('Endereço não encontrado. Selecione uma sugestão da lista.', 'error')
      btn.disabled = false; btn.textContent = 'Salvar'
      return
    }
    pendingLatLng = L.latLng(coords.lat, coords.lng)
    placeTempMarker(pendingLatLng)
    map.flyTo(pendingLatLng, 17)
  }

  btn.disabled = true; btn.textContent = 'Salvando…'

  const { error } = await sb.from(TABLE).insert({
    endereco:         endereco,
    bairro:           bairro,
    area_cabo:        document.getElementById('f-area-cabo').value.trim(),
    sp:               document.getElementById('f-sp').value.trim(),
    sec:              document.getElementById('f-sec').value.trim(),
    status:           document.getElementById('f-status').value,
    lat:              pendingLatLng.lat,
    lng:              pendingLatLng.lng,
    status_aprovacao: isAdmin ? 'aprovado' : 'pendente',
    submetido_por:    currentUser?.email || '',
  })

  btn.disabled = false; btn.textContent = 'Salvar'

  if (error) {
    alert('Erro ao salvar: ' + error.message)
  } else {
    closeModal()
    if (!isAdmin) {
      // Mostra mensagem de análise para usuários comuns
      const hint = document.getElementById('hint')
      hint.textContent = '✅ CTO enviada para análise — aguarde aprovação do administrador'
      hint.style.color = '#4ade80'
      setTimeout(() => {
        hint.textContent = 'Toque no mapa ou use 📍 para registrar uma CTO'
        hint.style.color = ''
      }, 5000)
    }
  }
}

// ── Aprovar / Rejeitar (admin) ────────────────────────────────
window.aprovarCto = async (id) => {
  await sb.from(TABLE).update({ status_aprovacao: 'aprovado' }).eq('id', id)
  map.closePopup()
  document.getElementById('painel-admin').classList.remove('open')
}

window.rejeitarCto = async (id) => {
  if (!confirm('Rejeitar e remover esta CTO?')) return
  await sb.from(TABLE).delete().eq('id', id)
  map.closePopup()
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
    document.getElementById('painel-admin').classList.remove('open')
  }
}

// ── Modal ─────────────────────────────────────────────────────
function openModal() {
  document.getElementById('f-endereco').value  = ''
  document.getElementById('f-bairro').value    = ''
  document.getElementById('f-area-cabo').value = ''
  document.getElementById('f-sp').value        = ''
  document.getElementById('f-sec').value       = ''
  document.getElementById('f-status').value    = 'Ativa'
  setGeocodeMsg('', '')
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

// ── Popups ────────────────────────────────────────────────────
function buildPopupHTML(row) {
  const dt   = row.criado ? new Date(row.criado).toLocaleString('pt-BR') : '—'
  const opts = ['Ativa', 'Em manutenção', 'Danificada', 'Desconhecida']
    .map((s) => `<option ${s === row.status ? 'selected' : ''}>${s}</option>`).join('')
  const enderecoHtml = row.endereco || row.bairro
    ? `<div class="popup-meta"><span class="popup-tag">📍</span> ${escHtml([row.endereco, row.bairro].filter(Boolean).join(' — '))}</div>` : ''
  const areaCaboHtml = row.area_cabo
    ? `<div class="popup-meta"><span class="popup-tag">ÁREA</span> ${escHtml(row.area_cabo)}</div>` : ''
  const spHtml  = row.sp  ? `<div class="popup-meta"><span class="popup-tag">SP</span> ${escHtml(row.sp)}</div>` : ''
  const secHtml = row.sec ? `<div class="popup-meta"><span class="popup-tag">SEC</span> ${escHtml(row.sec)}</div>` : ''
  const deleteBtn = isAdmin ? `<button class="popup-del" onclick="deleteCto('${row.id}')">🗑 Remover</button>` : ''
  return `
    <div class="popup">
      <div class="popup-nome">${escHtml(row.area_cabo || 'CTO')}</div>
      ${enderecoHtml}${areaCaboHtml}${spHtml}${secHtml}
      <div class="popup-row">
        <label>Status:</label>
        <select onchange="changeStatus('${row.id}', this.value)">${opts}</select>
      </div>
      <div class="popup-coords">${row.lat.toFixed(6)}, ${row.lng.toFixed(6)}</div>
      <div class="popup-date">${dt}</div>
      ${deleteBtn}
    </div>`
}

function buildPopupPendenteHTML(row) {
  const enderecoHtml = row.endereco || row.bairro
    ? `<div class="popup-meta"><span class="popup-tag">📍</span> ${escHtml([row.endereco, row.bairro].filter(Boolean).join(' — '))}</div>` : ''
  const areaCaboHtml = row.area_cabo ? `<div class="popup-meta"><span class="popup-tag">ÁREA</span> ${escHtml(row.area_cabo)}</div>` : ''
  const spHtml  = row.sp  ? `<div class="popup-meta"><span class="popup-tag">SP</span> ${escHtml(row.sp)}</div>` : ''
  const secHtml = row.sec ? `<div class="popup-meta"><span class="popup-tag">SEC</span> ${escHtml(row.sec)}</div>` : ''
  return `
    <div class="popup">
      <div class="popup-pendente-tag">⏳ Aguardando aprovação</div>
      <div class="popup-nome">${escHtml(row.area_cabo || 'CTO')}</div>
      ${enderecoHtml}${areaCaboHtml}${spHtml}${secHtml}
      <div class="popup-meta" style="color:#94a3b8;font-size:11px">Por: ${escHtml(row.submetido_por || '—')}</div>
      <div class="popup-actions-admin">
        <button class="btn-aprovar" onclick="aprovarCto('${row.id}')">✓ Aprovar</button>
        <button class="btn-rejeitar" onclick="rejeitarCto('${row.id}')">✕ Rejeitar</button>
      </div>
    </div>`
}

// ── Lista lateral ─────────────────────────────────────────────
function upsertListItem(row) {
  let li = document.getElementById('li-' + row.id)
  if (!li) { li = document.createElement('li'); li.id = 'li-' + row.id; document.getElementById('lista-ctos').appendChild(li) }
  const colors = { 'Ativa': '#22c55e', 'Em manutenção': '#f59e0b', 'Danificada': '#ef4444', 'Desconhecida': '#6b7280' }
  const c = colors[row.status] || '#6b7280'
  li.innerHTML = `
    <div class="list-item" onclick="focusMarker('${row.id}')">
      <span class="dot" style="background:${c}"></span>
      <div class="list-info">
        <strong>${escHtml(row.area_cabo || 'CTO')}</strong>
        <small>${row.status}${row.bairro ? ' · ' + escHtml(row.bairro) : ''}${row.endereco ? ' · ' + escHtml(row.endereco) : ''}</small>
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

// ── Painel admin (pendentes) ──────────────────────────────────
function upsertPendenteItem(row) {
  let li = document.getElementById('pli-' + row.id)
  if (!li) { li = document.createElement('li'); li.id = 'pli-' + row.id; document.getElementById('lista-pendentes').appendChild(li) }
  li.innerHTML = `
    <div class="list-item pendente-item" onclick="focusMarker('${row.id}')">
      <span class="dot" style="background:#f59e0b"></span>
      <div class="list-info">
        <strong>${escHtml(row.area_cabo || 'CTO')}</strong>
        <small>${escHtml(row.submetido_por || '—')}${row.bairro ? ' · ' + escHtml(row.bairro) : ''}</small>
      </div>
      <div class="pendente-btns">
        <button class="btn-aprovar-sm" onclick="event.stopPropagation();aprovarCto('${row.id}')">✓</button>
        <button class="btn-rejeitar-sm" onclick="event.stopPropagation();rejeitarCto('${row.id}')">✕</button>
      </div>
    </div>`
}

function removePendenteItem(id) {
  const li = document.getElementById('pli-' + id)
  if (li) li.remove()
  updatePendenteCount()
}

function updatePendenteCount() {
  const n = document.querySelectorAll('#lista-pendentes li').length
  const badge = document.getElementById('pendentes-badge')
  badge.textContent = n
  badge.style.display = n > 0 ? 'flex' : 'none'
}

// ── Painel lateral ────────────────────────────────────────────
document.getElementById('btn-lista').onclick = () => document.getElementById('painel').classList.toggle('open')
document.getElementById('btn-fechar-painel').onclick = () => document.getElementById('painel').classList.remove('open')

// ── Utilitários ───────────────────────────────────────────────
function escHtml(s) {
  if (!s) return ''
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}