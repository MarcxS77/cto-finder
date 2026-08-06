import { createClient } from '@supabase/supabase-js'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY  = import.meta.env.VITE_SUPABASE_KEY
const MAPBOX_TOKEN  = import.meta.env.VITE_MAPBOX_TOKEN
const TABLE         = 'ctos'
const credenciaisOk = !!SUPABASE_URL && !!SUPABASE_KEY

// Detecta redirect OAuth via sessionStorage (mais confiável que URL parsing)
const isOAuthRedirect = !!sessionStorage.getItem('oauth_pending') ||
                        window.location.hash.includes('access_token') ||
                        window.location.search.includes('code=')

let sb = null
if (credenciaisOk) {
  try {
    sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: {
        flowType: 'implicit',
        detectSessionInUrl: true,
        persistSession: true,
      }
    })
  }
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
  // Marca que um redirect OAuth vai acontecer (lido de volta ao retornar)
  sessionStorage.setItem('oauth_pending', '1')
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin },
  })
  if (error) {
    sessionStorage.removeItem('oauth_pending')
    showAuthMsg(error.message, 'error')
  }
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

async function handleSession(session) {
  if (session) {
    sessionStorage.removeItem('oauth_pending')
    currentUser = session.user

    // Verifica admin no banco — não no frontend
    const { data: profile } = await sb
      .from('profiles')
      .select('is_admin')
      .eq('id', currentUser.id)
      .single()
    isAdmin = !!profile?.is_admin

    document.getElementById('loading-screen').style.display = 'none'
    document.getElementById('login-screen').style.display = 'none'
    document.getElementById('app').style.display = 'block'
    showUserInfo(currentUser)
    if (isAdmin) {
      document.getElementById('btn-pendentes').style.display = 'flex'
      document.getElementById('admin-badge-wrap').style.display = 'block'
      initAdminPanel()
    }
    if (!mapInitialized) {
      initMap()
      initSearch()
      makeDraggable(document.getElementById('painel'),       true)
      makeDraggable(document.getElementById('painel-admin'), false)
      mapInitialized = true
    }
  } else {
    currentUser = null
    isAdmin     = false
    // Só mostra login se NÃO estiver processando redirect OAuth
    if (!isOAuthRedirect) {
      document.getElementById('loading-screen').style.display = 'none'
      document.getElementById('login-screen').style.display = 'flex'
      document.getElementById('app').style.display = 'none'
    }
    // Se for redirect OAuth, mantém o loading até o SIGNED_IN disparar
  }
}

if (sb) {
  sb.auth.onAuthStateChange((event, session) => {
    handleSession(session)
  })
}

// Fallback: se OAuth travar por mais de 10s, desiste e mostra login
if (isOAuthRedirect) {
  setTimeout(() => {
    const loading = document.getElementById('loading-screen')
    if (loading && loading.style.display !== 'none') {
      sessionStorage.removeItem('oauth_pending')
      loading.style.display = 'none'
      document.getElementById('login-screen').style.display = 'flex'
    }
  }, 10000)
}

document.getElementById('btn-logout').onclick = () => { if (sb) sb.auth.signOut() }

// ══════════════════════════════════════
//  BUSCA
// ══════════════════════════════════════
function initSearch() {
  const panel    = document.getElementById('search-panel')
  const input    = document.getElementById('search-input')
  const results  = document.getElementById('search-results')
  const empty    = document.getElementById('search-empty')
  const btnOpen  = document.getElementById('btn-search-toggle')
  const btnClose = document.getElementById('btn-search-close')

  btnOpen.onclick = () => {
    panel.classList.toggle('open')
    if (panel.classList.contains('open')) {
      input.value = ''
      results.innerHTML = ''
      empty.style.display = 'none'
      setTimeout(() => input.focus(), 50)
    }
  }

  btnClose.onclick = () => {
    panel.classList.remove('open')
    input.value = ''
    results.innerHTML = ''
    empty.style.display = 'none'
  }

  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase()
    results.innerHTML = ''
    empty.style.display = 'none'
    if (!q) return

    const matches = Object.values(ctoData).filter(row => {
      return [row.endereco, row.bairro, row.area_cabo, row.sp, row.sec, row.status]
        .some(v => v && v.toString().toLowerCase().includes(q))
    })

    if (!matches.length) { empty.style.display = 'block'; return }

    const statusClass = { 'Ativa': 'ativa', 'Em manutenção': 'manutencao', 'Danificada': 'danificada', 'Desconhecida': 'desconhecida' }
    matches.slice(0, 30).forEach(row => {
      const li = document.createElement('li')
      const cls = statusClass[row.status] || 'desconhecida'
      const addr = [row.numero ? `Nº ${row.numero}` : '', row.endereco].filter(Boolean).join(' ')
      li.innerHTML = `
        <span class="sr-icon"><i class="ph-fill ph-battery-vertical-full" style="color:#39ff14"></i></span>
        <div class="sr-info">
          <div class="sr-endereco">${escHtml(addr || '—')}</div>
          <div class="sr-meta">${escHtml(row.bairro || '')}${row.area_cabo ? ' · ' + escHtml(row.area_cabo) : ''}${row.sp ? ' · SP ' + escHtml(row.sp) : ''}</div>
        </div>
        <span class="sr-status ${cls}">${escHtml(row.status)}</span>`
      li.onclick = () => {
        panel.classList.remove('open')
        input.value = ''
        results.innerHTML = ''
        map.flyTo([row.lat, row.lng], 19, { duration: 1 })
        setTimeout(() => { if (markers[row.id]) markers[row.id].openPopup() }, 1100)
      }
      results.appendChild(li)
    })
  })
}

// ══════════════════════════════════════
//  SWIPE PARA ABRIR/FECHAR PAINÉIS
// ══════════════════════════════════════
function makeDraggable(panelEl, fromLeft) {
  // fromLeft=true → painel vem da esquerda (#painel)
  // fromLeft=false → painel vem da direita (#painel-admin)
  const EDGE_ZONE  = 32   // px da borda da tela para iniciar arraste quando fechado
  const SNAP_RATIO = 0.35 // fração da largura para "snap" abrir/fechar

  let startX = 0, startY = 0, panelW = 0, tracking = false, moved = false

  function baseOffset() {
    // offset inicial em px conforme estado atual
    const open = panelEl.classList.contains('open')
    if (fromLeft)  return open ? 0 : -panelW
    else           return open ? 0 :  panelW
  }

  function setX(px) {
    panelEl.style.transition = 'none'
    panelEl.style.transform  = `translateX(${px}px)`
  }

  function commit(open) {
    panelEl.style.transition = ''
    panelEl.style.transform  = ''
    panelEl.classList.toggle('open', open)
  }

  document.addEventListener('touchstart', (e) => {
    panelW   = panelEl.offsetWidth
    startX   = e.touches[0].clientX
    startY   = e.touches[0].clientY
    tracking = false
    moved    = false

    const open = panelEl.classList.contains('open')
    if (fromLeft) {
      if (open  && startX < panelW + 10)               tracking = true
      if (!open && startX < EDGE_ZONE)                 tracking = true
    } else {
      if (open  && startX > window.innerWidth - panelW - 10) tracking = true
      if (!open && startX > window.innerWidth - EDGE_ZONE)   tracking = true
    }
  }, { passive: true })

  document.addEventListener('touchmove', (e) => {
    if (!tracking) return
    const dx = e.touches[0].clientX - startX
    const dy = e.touches[0].clientY - startY

    if (!moved) {
      // Cancela se gesto for mais vertical que horizontal
      if (Math.abs(dy) > Math.abs(dx)) { tracking = false; return }
      moved = true
    }

    e.preventDefault()
    const base    = baseOffset()
    const raw     = base + dx
    const clamped = fromLeft
      ? Math.max(-panelW, Math.min(0, raw))
      : Math.max(0,       Math.min(panelW, raw))
    setX(clamped)
  }, { passive: false })

  document.addEventListener('touchend', (e) => {
    if (!tracking || !moved) { tracking = false; return }
    tracking = false

    const dx   = e.changedTouches[0].clientX - startX
    const open = panelEl.classList.contains('open')

    let shouldOpen
    if (fromLeft) {
      shouldOpen = open
        ? dx > -panelW * SNAP_RATIO   // estava aberto: fecha só se arrastou o suficiente
        : dx >  panelW * SNAP_RATIO   // estava fechado: abre se arrastou o suficiente
    } else {
      shouldOpen = open
        ? dx <  panelW * SNAP_RATIO
        : dx < -panelW * SNAP_RATIO
    }
    commit(shouldOpen)
  }, { passive: true })
}

// ══════════════════════════════════════
//  MAPA
// ══════════════════════════════════════
let map, markers = {}, pendingLatLng = null, tempMarker = null, ctoData = {}

function initMap() {
  map = L.map('map', { zoomControl: false }).setView([-23.5886, -46.6097], 15)
  const tileUrl = MAPBOX_TOKEN
    ? `https://api.mapbox.com/styles/v1/mapbox/dark-v11/tiles/{z}/{x}/{y}@2x?access_token=${MAPBOX_TOKEN}`
    : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'

  L.tileLayer(tileUrl, {
    attribution: MAPBOX_TOKEN
      ? '© <a href="https://www.mapbox.com/">Mapbox</a> © <a href="https://www.openstreetmap.org/">OpenStreetMap</a>'
      : '© OpenStreetMap contributors',
    tileSize:   MAPBOX_TOKEN ? 512 : 256,
    zoomOffset: MAPBOX_TOKEN ? -1  : 0,
    maxZoom: 22,
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

// ── Alertas ──────────────────────────────────────────────────
let alertasCount = {}  // cto_id → número de alertas
let myAlertas    = new Set()  // cto_ids que o usuário atual reportou

async function loadAlertas() {
  const { data } = await sb.from('alertas').select('cto_id, user_id')
  if (!data) return
  alertasCount = {}
  myAlertas    = new Set()
  data.forEach(a => {
    alertasCount[a.cto_id] = (alertasCount[a.cto_id] || 0) + 1
    if (a.user_id === currentUser.id) myAlertas.add(a.cto_id)
  })
}

window.reportarAlerta = async (ctoId) => {
  const jaReportou = myAlertas.has(ctoId)
  if (jaReportou) {
    await sb.from('alertas').delete().eq('cto_id', ctoId).eq('user_id', currentUser.id)
    myAlertas.delete(ctoId)
    alertasCount[ctoId] = Math.max(0, (alertasCount[ctoId] || 1) - 1)
  } else {
    await sb.from('alertas').insert({ cto_id: ctoId, user_id: currentUser.id })
    myAlertas.add(ctoId)
    alertasCount[ctoId] = (alertasCount[ctoId] || 0) + 1
  }
  // Atualiza popup aberto sem recarregar o mapa
  if (markers[ctoId]) {
    markers[ctoId].setPopupContent(buildPopupHTML(ctoData[ctoId]))
    markers[ctoId].openPopup()
  }
  // Atualiza ícone se tem alertas
  refreshMarkerIcon(ctoId)
}

window.dispensarAlertas = async (ctoId) => {
  await sb.from('alertas').delete().eq('cto_id', ctoId)
  alertasCount[ctoId] = 0
  myAlertas.delete(ctoId)
  if (markers[ctoId]) {
    markers[ctoId].setPopupContent(buildPopupHTML(ctoData[ctoId]))
  }
  refreshMarkerIcon(ctoId)
}

function refreshMarkerIcon(ctoId) {
  if (!markers[ctoId] || !ctoData[ctoId]) return
  const row  = ctoData[ctoId]
  const icon = (alertasCount[ctoId] || 0) > 0 ? makeIconAlerta(row.status) : makeIcon(row.status)
  markers[ctoId].setIcon(icon)
}

async function loadCtos() {
  // Admin vê tudo; usuários comuns veem só aprovadas
  let query = sb.from(TABLE).select('*')
  if (!isAdmin) query = query.eq('status_aprovacao', 'aprovado')
  const { data, error } = await query
  if (error) { console.error(error.message); return }

  await loadAlertas()

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
        removeTodasItem(row.id)
        removeAtividadeItem(row.id)
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
        removeTodasItem(row.id)
        removeAtividadeItem(row.id)
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
  const html = `
    <div style="
      color:${c};
      font-size:38px;
      line-height:1;
      filter:drop-shadow(0 2px 8px rgba(0,0,0,0.7));
    ">
      <i class="ph-fill ph-battery-vertical-full"></i>
    </div>`
  return L.divIcon({ html, className: '', iconSize: [38, 38], iconAnchor: [19, 38], popupAnchor: [0, -38] })
}

function makeIconAlerta(status) {
  const colors = {
    'Ativa': '#22c55e', 'Em manutenção': '#f59e0b',
    'Danificada': '#ef4444', 'Desconhecida': '#6b7280',
  }
  const c = colors[status] || '#6b7280'
  const html = `
    <div style="position:relative;display:inline-block;">
      <div style="color:${c};font-size:38px;line-height:1;filter:drop-shadow(0 2px 8px rgba(0,0,0,0.7));">
        <i class="ph-fill ph-battery-vertical-full"></i>
      </div>
      <div style="position:absolute;top:-4px;right:-6px;background:#f97316;color:#fff;font-size:10px;font-weight:700;border-radius:50%;width:16px;height:16px;display:flex;align-items:center;justify-content:center;line-height:1;">!</div>
    </div>`
  return L.divIcon({ html, className: '', iconSize: [44, 38], iconAnchor: [19, 38], popupAnchor: [0, -38] })
}

function makeIconPendente() {
  const html = `
    <div class="marker-pendente" style="
      color:#f59e0b;
      font-size:38px;
      line-height:1;
      filter:drop-shadow(0 2px 8px rgba(0,0,0,0.7));
    ">
      <i class="ph-fill ph-battery-vertical-full"></i>
    </div>`
  return L.divIcon({ html, className: '', iconSize: [38, 38], iconAnchor: [19, 38], popupAnchor: [0, -38] })
}

function addMarker(row) {
  ctoData[row.id] = row
  const icon = (alertasCount[row.id] || 0) > 0 ? makeIconAlerta(row.status) : makeIcon(row.status)
  const m = L.marker([row.lat, row.lng], { icon })
    .addTo(map).bindPopup(buildPopupHTML(row))
  markers[row.id] = m
  upsertListItem(row)
  if (isAdmin) { upsertTodasItem(row); upsertAtividadeItem(row) }
}

function addMarkerPendente(row) {
  ctoData[row.id] = row
  const m = L.marker([row.lat, row.lng], { icon: makeIconPendente() })
    .addTo(map).bindPopup(buildPopupPendenteHTML(row))
  markers[row.id] = m
  upsertPendenteItem(row)
  if (isAdmin) { upsertTodasItem(row); upsertAtividadeItem(row) }
}

function removeMarker(id) {
  if (markers[id]) { markers[id].remove(); delete markers[id] }
  delete ctoData[id]
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

function parseMapboxFeature(f) {
  const ctx    = f.context || []
  const parts  = f.place_name.split(',')
  const rua    = parts[0].trim()
  const bCtx   = ctx.find(c => c.id.startsWith('neighborhood') || c.id.startsWith('locality'))
  const cCtx   = ctx.find(c => c.id.startsWith('place'))
  const bairro = bCtx ? bCtx.text : (parts[1] ? parts[1].trim() : '')
  const cidade = cCtx ? cCtx.text : ''
  return { rua, bairro, cidade, lat: f.center[1], lng: f.center[0] }
}

function showAutocomplete(features) {
  const list = document.getElementById('autocomplete-list')
  list.innerHTML = ''
  if (!features.length) { list.style.display = 'none'; return }
  features.forEach((f) => {
    const { rua, bairro, cidade, lat, lng } = parseMapboxFeature(f)
    const item = document.createElement('div')
    item.className = 'autocomplete-item'
    item.innerHTML = `
      <div class="ac-rua">${escHtml(rua)}</div>
      <div class="ac-bairro">${escHtml([bairro, cidade].filter(Boolean).join(' · '))}</div>`
    item.onmousedown = (e) => {
      e.preventDefault()
      document.getElementById('f-endereco').value = rua
      document.getElementById('f-bairro').value   = bairro
      pendingLatLng = L.latLng(lat, lng)
      placeTempMarker(pendingLatLng)
      map.flyTo(pendingLatLng, 17)
      hideAutocomplete()
      setGeocodeMsg('✓ Rua encontrada — preencha o número para maior precisão', 'success')
      document.getElementById('f-numero').focus()
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
      if (MAPBOX_TOKEN) {
        // proximity = centro de SP para priorizar a cidade sem restringir outros bairros
        const SP_CENTER = '-46.6333,-23.5505'
        const url  = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${MAPBOX_TOKEN}&country=BR&language=pt&types=address&autocomplete=true&limit=6&proximity=${SP_CENTER}`
        const res  = await fetch(url)
        const data = await res.json()
        showAutocomplete(data.features || [])
      } else {
        // fallback Nominatim
        const url  = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=6&countrycodes=br&addressdetails=1`
        const res  = await fetch(url, { headers: { 'Accept-Language': 'pt-BR' } })
        const rows = await res.json()
        // adapta para formato esperado por showAutocomplete via Mapbox shape
        const features = rows.map(r => ({
          place_name: r.display_name,
          center: [parseFloat(r.lon), parseFloat(r.lat)],
          context: [],
        }))
        showAutocomplete(features)
      }
    } catch (_) {}
  }, 400)
})
document.getElementById('f-endereco').addEventListener('blur', () => setTimeout(hideAutocomplete, 150))

async function geocodeAddress(endereco, numero, bairro) {
  if (MAPBOX_TOKEN) {
    try {
      // Mapbox interpola numeração com precisão
      const query  = [numero ? `${numero} ${endereco}` : endereco, bairro, 'São Paulo'].filter(Boolean).join(', ')
      const url    = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${MAPBOX_TOKEN}&country=BR&language=pt&types=address&limit=1&proximity=-46.6333,-23.5505`
      const res   = await fetch(url)
      const data  = await res.json()
      if (data.features && data.features.length > 0) {
        const [lng, lat] = data.features[0].center
        return { lat, lng }
      }
    } catch (_) {}
  }
  // Fallback Nominatim
  try {
    const endComNumero = [endereco, numero].filter(Boolean).join(', ')
    const query = [endComNumero, bairro].filter(Boolean).join(', ')
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
  const numero   = document.getElementById('f-numero').value.trim()
  const bairro   = document.getElementById('f-bairro').value.trim()

  // Se tem número, refina a localização com o número
  if (pendingLatLng && numero) {
    const coords = await geocodeAddress(endereco, numero, bairro)
    if (coords) {
      pendingLatLng = L.latLng(coords.lat, coords.lng)
      placeTempMarker(pendingLatLng)
    }
  }

  if (!pendingLatLng) {
    if (!endereco && !bairro) return setGeocodeMsg('Selecione um endereço na lista ou clique no mapa.', 'error')
    btn.disabled = true; btn.textContent = 'Buscando…'
    setGeocodeMsg('Buscando localização…', '')
    const coords = await geocodeAddress(endereco, numero, bairro)
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
    numero:           numero,
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
  document.getElementById('f-numero').value    = ''
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
  const endFull = [row.endereco, row.numero].filter(Boolean).join(', ')
  const enderecoHtml = endFull || row.bairro
    ? `<div class="popup-meta"><span class="popup-tag">📍</span> ${escHtml([endFull, row.bairro].filter(Boolean).join(' — '))}</div>` : ''
  const areaCaboHtml = row.area_cabo
    ? `<div class="popup-meta"><span class="popup-tag">ÁREA</span> ${escHtml(row.area_cabo)}</div>` : ''
  const spHtml  = row.sp  ? `<div class="popup-meta"><span class="popup-tag">SP</span> ${escHtml(row.sp)}</div>` : ''
  const secHtml = row.sec ? `<div class="popup-meta"><span class="popup-tag">SEC</span> ${escHtml(row.sec)}</div>` : ''

  const statusRow = isAdmin
    ? (() => {
        const opts = ['Ativa', 'Em manutenção', 'Danificada', 'Desconhecida']
          .map((s) => `<option ${s === row.status ? 'selected' : ''}>${s}</option>`).join('')
        return `<div class="popup-row">
          <label>Status:</label>
          <select onchange="changeStatus('${row.id}', this.value)">${opts}</select>
        </div>`
      })()
    : `<div class="popup-row">
        <label>Status:</label>
        <span class="popup-status-badge">${escHtml(row.status)}</span>
      </div>`

  const adminBtns = isAdmin
    ? `<div class="popup-admin-btns">
        <button class="popup-edit" onclick="editCto('${row.id}')">✏️ Editar</button>
        <button class="popup-del"  onclick="deleteCto('${row.id}')">🗑 Remover</button>
      </div>` : ''

  const mapsUrl    = `https://www.google.com/maps/dir/?api=1&destination=${row.lat},${row.lng}`
  const count      = alertasCount[row.id] || 0
  const jaReportou = myAlertas.has(row.id)

  const alertaBtn = isAdmin
    ? (count > 0
        ? `<button class="popup-alerta-dismiss" onclick="dispensarAlertas('${row.id}')">
             ⚠️ ${count} alerta${count > 1 ? 's' : ''} — Dispensar
           </button>`
        : '')
    : `<button class="popup-alerta-btn ${jaReportou ? 'reportado' : ''}" onclick="reportarAlerta('${row.id}')">
         ${jaReportou ? '✓ Ausência reportada' : '⚠️ Reportar ausência'}
       </button>`

  return `
    <div class="popup">
      <div class="popup-nome">${escHtml(row.area_cabo || 'CTO')}</div>
      ${enderecoHtml}${areaCaboHtml}${spHtml}${secHtml}
      ${statusRow}
      <div class="popup-coords">${row.lat.toFixed(6)}, ${row.lng.toFixed(6)}</div>
      <div class="popup-date">${dt}</div>
      <a class="popup-maps-btn" href="${mapsUrl}" target="_blank" rel="noopener">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
        Abrir rota no Google Maps
      </a>
      ${alertaBtn}
      ${adminBtns}
    </div>`
}

function buildPopupPendenteHTML(row) {
  const endFull = [row.endereco, row.numero].filter(Boolean).join(', ')
  const enderecoHtml = endFull || row.bairro
    ? `<div class="popup-meta"><span class="popup-tag">📍</span> ${escHtml([endFull, row.bairro].filter(Boolean).join(' — '))}</div>` : ''
  const areaCaboHtml = row.area_cabo ? `<div class="popup-meta"><span class="popup-tag">ÁREA</span> ${escHtml(row.area_cabo)}</div>` : ''
  const spHtml  = row.sp  ? `<div class="popup-meta"><span class="popup-tag">SP</span> ${escHtml(row.sp)}</div>` : ''
  const secHtml = row.sec ? `<div class="popup-meta"><span class="popup-tag">SEC</span> ${escHtml(row.sec)}</div>` : ''
  const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${row.lat},${row.lng}`

  return `
    <div class="popup">
      <div class="popup-pendente-tag">⏳ Aguardando aprovação</div>
      <div class="popup-nome">${escHtml(row.area_cabo || 'CTO')}</div>
      ${enderecoHtml}${areaCaboHtml}${spHtml}${secHtml}
      <div class="popup-meta" style="color:#94a3b8;font-size:11px">Por: ${escHtml(row.submetido_por || '—')}</div>
      <a class="popup-maps-btn" href="${mapsUrl}" target="_blank" rel="noopener">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
        Abrir rota no Google Maps
      </a>
      <div class="popup-actions-admin">
        <button class="btn-aprovar" onclick="aprovarCto('${row.id}')">✓ Aprovar</button>
        <button class="btn-rejeitar" onclick="rejeitarCto('${row.id}')">✕ Rejeitar</button>
      </div>
    </div>`
}

// ── Lista lateral agrupada por área ───────────────────────────
const openGroups = new Set()   // grupos expandidos
const STATUS_COLORS = { 'Ativa': '#22c55e', 'Em manutenção': '#f59e0b', 'Danificada': '#ef4444', 'Desconhecida': '#6b7280' }

function upsertListItem(_row) { renderGroupedList() }
function removeListItem(_id)  { renderGroupedList() }

function renderGroupedList() {
  const lista = document.getElementById('lista-ctos')

  // Agrupa por area_cabo
  const groups = {}
  Object.values(ctoData)
    .filter(r => r.status_aprovacao === 'aprovado' || isAdmin)
    .forEach(r => {
      const key = r.area_cabo || '—'
      if (!groups[key]) groups[key] = []
      groups[key].push(r)
    })

  // Ordena grupos alfabeticamente
  const sortedKeys = Object.keys(groups).sort()

  lista.innerHTML = ''

  sortedKeys.forEach(key => {
    const rows = groups[key].sort((a, b) => (a.sp || '').localeCompare(b.sp || ''))
    const isOpen = openGroups.has(key)

    // Status geral do grupo (pior status)
    const priority = ['Danificada', 'Em manutenção', 'Desconhecida', 'Ativa']
    const worstStatus = priority.find(s => rows.some(r => r.status === s)) || 'Desconhecida'
    const groupColor  = STATUS_COLORS[worstStatus] || '#6b7280'
    const hasAlerta   = rows.some(r => (alertasCount[r.id] || 0) > 0)

    const li = document.createElement('li')
    li.className = 'group-li'
    li.id = 'grp-' + CSS.escape(key)

    const childEls = rows.map(r => {
      const c    = STATUS_COLORS[r.status] || '#6b7280'
      const info = [r.sp ? 'SP: ' + r.sp : '', r.sec ? 'SEC: ' + r.sec : '', r.status].filter(Boolean).join(' · ')
      const alerta = (alertasCount[r.id] || 0) > 0 ? ' <span class="grp-alerta-dot">!</span>' : ''
      const addr   = r.endereco ? `<small class="grp-addr">${escHtml([r.numero, r.endereco].filter(Boolean).join(' '))}</small>` : ''
      const el = document.createElement('li')
      el.className = 'group-child'
      el.innerHTML = `
        <span class="dot" style="background:${c};flex-shrink:0"></span>
        <div class="list-info">
          <small>${escHtml(info)}${alerta}</small>
          ${addr}
        </div>
        <span class="list-arrow">›</span>`
      el.addEventListener('click', () => focusMarker(r.id))
      return el
    })
    const children = childEls

    const header = document.createElement('div')
    header.className = 'group-header'
    header.innerHTML = `
      <span class="group-chevron">${isOpen ? '▾' : '▸'}</span>
      <span class="dot" style="background:${groupColor};flex-shrink:0"></span>
      <div class="list-info">
        <strong>${escHtml(key)}${hasAlerta ? ' <span class="grp-alerta-dot">!</span>' : ''}</strong>
        <small>${rows.length} CTO${rows.length !== 1 ? 's' : ''}</small>
      </div>`
    header.addEventListener('click', () => {
      if (openGroups.has(key)) openGroups.delete(key)
      else openGroups.add(key)
      renderGroupedList()
    })

    const ul = document.createElement('ul')
    ul.className = 'group-children'
    ul.style.display = isOpen ? 'block' : 'none'
    children.forEach(el => ul.appendChild(el))

    li.appendChild(header)
    li.appendChild(ul)
    lista.appendChild(li)
  })

  updateCount()
}

function updateCount() {
  const n   = Object.values(ctoData).filter(r => r.status_aprovacao === 'aprovado' || isAdmin).length
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
  const badge    = document.getElementById('pendentes-badge')
  const tabBadge = document.getElementById('pendentes-tab-count')
  badge.textContent = n
  badge.style.display = n > 0 ? 'flex' : 'none'
  if (tabBadge) tabBadge.textContent = n
}

// ── Painel admin: abas ────────────────────────────────────────
window.switchAdminTab = function (tab) {
  document.getElementById('lista-pendentes').style.display = tab === 'pendentes' ? 'block' : 'none'
  document.getElementById('lista-todas').style.display     = tab === 'todas'     ? 'block' : 'none'
  document.getElementById('lista-atividade').style.display = tab === 'atividade' ? 'block' : 'none'
  document.getElementById('lista-usuarios').style.display  = tab === 'usuarios'  ? 'block' : 'none'
  document.querySelectorAll('.admin-tab').forEach((t) =>
    t.classList.toggle('active', t.dataset.tab === tab)
  )
  if (tab === 'usuarios') loadUsuarios()
}

async function loadUsuarios() {
  const container = document.getElementById('lista-usuarios')
  container.innerHTML = '<div class="usuarios-loading">Carregando…</div>'

  const { data: perfis, error } = await sb.from('profiles').select('*').order('created_at', { ascending: false })
  if (error) { container.innerHTML = '<div class="usuarios-loading">Erro ao carregar.</div>'; return }

  // Conta CTOs por usuário (pelo email em submetido_por)
  const ctoCounts = {}
  Object.values(ctoData).forEach(row => {
    if (row.submetido_por) ctoCounts[row.submetido_por] = (ctoCounts[row.submetido_por] || 0) + 1
  })

  container.innerHTML = ''

  if (!perfis.length) {
    container.innerHTML = '<div class="usuarios-loading">Nenhum usuário encontrado.</div>'
    return
  }

  perfis.forEach(p => {
    const nome    = p.full_name || p.email || 'Sem nome'
    const inicial = nome[0].toUpperCase()
    const dt      = p.created_at ? new Date(p.created_at).toLocaleDateString('pt-BR') : '—'
    const ctos    = ctoCounts[p.email] || 0
    const isAdminUser = !!p.is_admin

    const card = document.createElement('div')
    card.className = 'usuario-card'
    card.innerHTML = `
      <div class="usuario-avatar">
        ${p.avatar_url
          ? `<img src="${p.avatar_url}" alt="avatar" />`
          : `<span>${escHtml(inicial)}</span>`}
      </div>
      <div class="usuario-info">
        <div class="usuario-nome">${escHtml(nome)} ${isAdminUser ? '<span class="usuario-admin-badge">admin</span>' : ''}</div>
        <div class="usuario-email">${escHtml(p.email || '—')}</div>
        <div class="usuario-meta">📅 ${dt} · 📦 ${ctos} CTO${ctos !== 1 ? 's' : ''}</div>
      </div>`
    container.appendChild(card)
  })
}

// ── Lista "Todas as CTOs" (admin) ─────────────────────────────
function upsertTodasItem(row) {
  let li = document.getElementById('tai-' + row.id)
  if (!li) {
    li = document.createElement('li')
    li.id = 'tai-' + row.id
    document.getElementById('lista-todas').appendChild(li)
  }
  const colors = {
    'Ativa': '#22c55e', 'Em manutenção': '#f59e0b',
    'Danificada': '#ef4444', 'Desconhecida': '#6b7280',
  }
  const c = colors[row.status] || '#6b7280'
  const pendTag = row.status_aprovacao === 'pendente'
    ? '<span class="todas-badge">⏳</span>' : ''
  li.innerHTML = `
    <div class="list-item todas-item">
      <span class="dot" style="background:${c};flex-shrink:0"></span>
      <div class="list-info" onclick="focusMarker('${row.id}');document.getElementById('painel-admin').classList.remove('open')" style="cursor:pointer">
        <strong>${escHtml(row.area_cabo || 'CTO')} ${pendTag}</strong>
        <small>${escHtml(row.status)}${row.bairro ? ' · ' + escHtml(row.bairro) : ''}${row.endereco ? ' · ' + escHtml(row.endereco) : ''}</small>
      </div>
      <div class="todas-actions">
        <button class="todas-btn edit-btn" title="Editar"  onclick="editCto('${row.id}')">✏️</button>
        <button class="todas-btn del-btn"  title="Remover" onclick="deleteCtoAdmin('${row.id}')">🗑</button>
      </div>
    </div>`
}

function removeTodasItem(id) {
  const li = document.getElementById('tai-' + id)
  if (li) li.remove()
}

// ── Lista de Inserções (admin) ────────────────────────────────
function upsertAtividadeItem(row) {
  const lista = document.getElementById('lista-atividade')
  if (!lista) return   // guard: index.html antigo sem o elemento
  let li = document.getElementById('ati-' + row.id)
  if (!li) {
    li = document.createElement('li')
    li.id = 'ati-' + row.id
    li.dataset.criado = row.criado || ''
    // Insere na posição correta (mais recente no topo)
    const items = Array.from(lista.children)
    const after = items.find(el => (el.dataset.criado || '') < (row.criado || ''))
    lista.insertBefore(li, after || null)
  }
  const dt      = row.criado ? new Date(row.criado).toLocaleString('pt-BR') : '—'
  const usuario = row.submetido_por || 'Desconhecido'
  const inicial = usuario[0].toUpperCase()
  const isPend  = row.status_aprovacao === 'pendente'
  const badgeCls = isPend ? 'ativ-badge pendente' : 'ativ-badge aprovado'
  const badgeTxt = isPend ? '⏳ Pendente' : '✓ Aprovado'

  li.innerHTML = `
    <div class="ativ-item" onclick="focusMarker('${row.id}');switchAdminTab('atividade')">
      <div class="ativ-avatar">${escHtml(inicial)}</div>
      <div class="ativ-info">
        <strong>${escHtml(row.area_cabo || 'CTO')}</strong>
        <small>${escHtml(usuario)}</small>
        <small class="ativ-date">🕒 ${dt}</small>
      </div>
      <span class="${badgeCls}">${badgeTxt}</span>
    </div>`
}

function removeAtividadeItem(id) {
  const li = document.getElementById('ati-' + id)
  if (li) li.remove()
}

// ── Editar CTO (admin) ────────────────────────────────────────
window.editCto = function (id) {
  const row = ctoData[id]
  if (!row) return
  document.getElementById('edit-id').value                  = id
  document.getElementById('edit-endereco').value            = row.endereco  || ''
  document.getElementById('edit-bairro').value              = row.bairro    || ''
  document.getElementById('edit-numero').value              = row.numero    || ''
  document.getElementById('edit-area-cabo').value           = row.area_cabo || ''
  document.getElementById('edit-sp').value                  = row.sp        || ''
  document.getElementById('edit-sec').value                 = row.sec       || ''
  document.getElementById('edit-status').value              = row.status    || 'Ativa'
  document.getElementById('edit-status-aprovacao').value    = row.status_aprovacao || 'pendente'
  document.getElementById('edit-msg').textContent           = ''
  document.getElementById('edit-msg').className             = 'geocode-msg'
  document.getElementById('modal-edit').style.display      = 'flex'
}

function initAdminPanel() {
  const cancelar  = document.getElementById('btn-edit-cancelar')
  const backdrop  = document.getElementById('modal-edit-backdrop')
  const salvar    = document.getElementById('btn-edit-salvar')
  if (!cancelar || !backdrop || !salvar) return   // index.html antigo — ignora

  cancelar.onclick = () => {
    document.getElementById('modal-edit').style.display = 'none'
  }
  backdrop.onclick = () => {
    document.getElementById('modal-edit').style.display = 'none'
  }
  salvar.onclick = async () => {
    const id  = document.getElementById('edit-id').value
    const btn = salvar
    btn.disabled = true; btn.textContent = 'Salvando…'
    const { error } = await sb.from(TABLE).update({
      endereco:         document.getElementById('edit-endereco').value.trim(),
      numero:           document.getElementById('edit-numero').value.trim(),
      bairro:           document.getElementById('edit-bairro').value.trim(),
      area_cabo:        document.getElementById('edit-area-cabo').value.trim(),
      sp:               document.getElementById('edit-sp').value.trim(),
      sec:              document.getElementById('edit-sec').value.trim(),
      status:           document.getElementById('edit-status').value,
      status_aprovacao: document.getElementById('edit-status-aprovacao').value,
    }).eq('id', id)
    btn.disabled = false; btn.textContent = 'Salvar'
    if (error) {
      const msg = document.getElementById('edit-msg')
      msg.textContent = 'Erro: ' + error.message
      msg.className   = 'geocode-msg error'
    } else {
      document.getElementById('modal-edit').style.display = 'none'
    }
  }
}

window.deleteCtoAdmin = async (id) => {
  if (!confirm('Remover esta CTO permanentemente?')) return
  await sb.from(TABLE).delete().eq('id', id)
}

// ── Painel lateral ────────────────────────────────────────────
document.getElementById('btn-lista').onclick = () => document.getElementById('painel').classList.toggle('open')
document.getElementById('btn-fechar-painel').onclick = () => document.getElementById('painel').classList.remove('open')

// ── Utilitários ───────────────────────────────────────────────
function escHtml(s) {
  if (!s) return ''
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
