// ============================================================
//  ACCOUNT SYSTEM + LOCAL STORAGE SAVE/LOAD
//  Fitur:
//  - Multi akun per device (max 5 akun)
//  - Data tersimpan di localStorage per device
//  - Auto-save setiap aksi penting
//  - Import/Export data (backup antar device)
//  - Account switcher di gems bar
// ============================================================

const SAVE_KEY_PREFIX = 'animegacha_account_';
const ACCOUNTS_LIST_KEY = 'animegacha_accounts';
const ACTIVE_ACCOUNT_KEY = 'animegacha_active_account';
const MAX_ACCOUNTS = 5;

// ── Ambil semua akun yang tersimpan di device ini ──
function getAccountsList() {
    try {
        return JSON.parse(localStorage.getItem(ACCOUNTS_LIST_KEY) || '[]');
    } catch { return []; }
}

function saveAccountsList(list) {
    localStorage.setItem(ACCOUNTS_LIST_KEY, JSON.stringify(list));
}

function getActiveAccountId() {
    return localStorage.getItem(ACTIVE_ACCOUNT_KEY) || null;
}

function setActiveAccountId(id) {
    localStorage.setItem(ACTIVE_ACCOUNT_KEY, id);
}

// ── Simpan data game ke localStorage ──
function saveGameData(accountId) {
    const id = accountId || getActiveAccountId();
    if (!id) return;
    const data = {
        gems,
        inventory,
        enchantments,
        luckLevel,
        luckExpiry,
        lastFreePullDate,
        pendingTopupRequests,
        savedAt: new Date().toISOString(),
    };
    localStorage.setItem(SAVE_KEY_PREFIX + id, JSON.stringify(data));

    // Update lastActive di daftar akun
    const list = getAccountsList();
    const acc = list.find(a => a.id === id);
    if (acc) {
        acc.lastActive = data.savedAt;
        acc.gems = gems;
        saveAccountsList(list);
    }
}

// ── Load data game dari localStorage ──
function loadGameData(accountId) {
    const id = accountId || getActiveAccountId();
    if (!id) return false;
    try {
        const raw = localStorage.getItem(SAVE_KEY_PREFIX + id);
        if (!raw) return false;
        const data = JSON.parse(raw);
        gems                  = data.gems                 ?? 0;
        inventory             = data.inventory            ?? {};
        enchantments          = data.enchantments         ?? {};
        luckLevel             = data.luckLevel            ?? 0;
        luckExpiry            = data.luckExpiry           ?? 0;
        lastFreePullDate      = data.lastFreePullDate     ?? null;
        pendingTopupRequests  = data.pendingTopupRequests ?? [];
        updateGemsUI();
        return true;
    } catch { return false; }
}

// ── Buat akun baru ──
function createNewAccount(username) {
    const list = getAccountsList();
    if (list.length >= MAX_ACCOUNTS) return { error: `Maksimal ${MAX_ACCOUNTS} akun per device.` };
    if (list.find(a => a.username.toLowerCase() === username.toLowerCase())) {
        return { error: 'Nama akun sudah dipakai di device ini.' };
    }
    const id = 'acc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    const newAcc = {
        id,
        username,
        createdAt: new Date().toISOString(),
        lastActive: new Date().toISOString(),
        gems: 0,
    };
    list.push(newAcc);
    saveAccountsList(list);

    // Init empty save
    localStorage.setItem(SAVE_KEY_PREFIX + id, JSON.stringify({
        gems: 0, inventory: {}, enchantments: {},
        luckLevel: 0, luckExpiry: 0,
        lastFreePullDate: null, pendingTopupRequests: [],
        savedAt: new Date().toISOString(),
    }));
    return { success: true, account: newAcc };
}

// ── Switch akun ──
function switchAccount(accountId) {
    // Simpan dulu akun sekarang
    const currentId = getActiveAccountId();
    if (currentId) saveGameData(currentId);

    // Ganti ke akun baru
    setActiveAccountId(accountId);
    const loaded = loadGameData(accountId);

    // Simpan player name juga
    const list = getAccountsList();
    const acc = list.find(a => a.id === accountId);
    if (acc) localStorage.setItem('animegacha_playerName', acc.username);

    return loaded;
}

// ── Hapus akun ──
function deleteAccount(accountId) {
    let list = getAccountsList();
    list = list.filter(a => a.id !== accountId);
    saveAccountsList(list);
    localStorage.removeItem(SAVE_KEY_PREFIX + accountId);

    // Kalau ini akun aktif, switch ke akun lain atau kosong
    if (getActiveAccountId() === accountId) {
        if (list.length > 0) {
            switchAccount(list[0].id);
        } else {
            localStorage.removeItem(ACTIVE_ACCOUNT_KEY);
            gems = 0; inventory = {}; enchantments = {};
            luckLevel = 0; luckExpiry = 0;
            lastFreePullDate = null; pendingTopupRequests = [];
            updateGemsUI();
        }
    }
}

// ── Export data akun (untuk backup / pindah device) ──
function exportAccountData(accountId) {
    const id = accountId || getActiveAccountId();
    const list = getAccountsList();
    const acc = list.find(a => a.id === id);
    const saveData = localStorage.getItem(SAVE_KEY_PREFIX + id);
    if (!acc || !saveData) return null;
    const exportObj = { account: acc, saveData: JSON.parse(saveData), exportedAt: new Date().toISOString() };
    return btoa(unescape(encodeURIComponent(JSON.stringify(exportObj))));
}

// ── Import data akun dari string export ──
function importAccountData(exportStr) {
    try {
        const json = JSON.parse(decodeURIComponent(escape(atob(exportStr.trim()))));
        const { account, saveData } = json;
        if (!account?.id || !saveData) return { error: 'Data tidak valid.' };

        const list = getAccountsList();

        // Cek apakah akun ini sudah ada (update) atau baru
        const existing = list.find(a => a.id === account.id);
        if (existing) {
            // Update data
            existing.username   = account.username;
            existing.lastActive = new Date().toISOString();
            existing.gems       = saveData.gems ?? 0;
        } else {
            if (list.length >= MAX_ACCOUNTS) return { error: `Maksimal ${MAX_ACCOUNTS} akun per device.` };
            list.push({
                ...account,
                lastActive: new Date().toISOString(),
                gems: saveData.gems ?? 0,
            });
        }
        saveAccountsList(list);
        localStorage.setItem(SAVE_KEY_PREFIX + account.id, JSON.stringify(saveData));
        return { success: true, username: account.username };
    } catch(e) {
        return { error: 'Gagal import: data korup atau tidak valid.' };
    }
}

// ── Auto-save hook: panggil ini di setiap updateGemsUI ──
let _autoSaveTimer = null;
function scheduleAutoSave() {
    clearTimeout(_autoSaveTimer);
    _autoSaveTimer = setTimeout(() => {
        const id = getActiveAccountId();
        if (id) saveGameData(id);
    }, 800);
}

// ============================================================
//  UI ACCOUNT MANAGER
// ============================================================
function injectAccountUI() {
    // Tambahkan button Account di gems-bar
    const gemsBar = document.querySelector('.gems-bar');
    if (gemsBar && !document.getElementById('account-btn')) {
        const btn = document.createElement('button');
        btn.id = 'account-btn';
        btn.className = 'btn-topup-quick';
        btn.style.cssText = 'background:linear-gradient(135deg,#1e293b,#334155);border:1px solid rgba(148,163,184,0.3);margin-right:6px;';
        btn.innerHTML = '<i class="fa-solid fa-user-circle"></i> <span id="account-name-short">Akun</span>';
        btn.onclick = openAccountModal;
        gemsBar.insertBefore(btn, gemsBar.querySelector('.btn-topup-quick'));
    }

    // Inject modal HTML
    if (!document.getElementById('accountModal')) {
        document.body.insertAdjacentHTML('beforeend', `
        <div class="modal fade" id="accountModal" tabindex="-1" aria-hidden="true">
          <div class="modal-dialog modal-dialog-centered modal-sm">
            <div class="modal-content text-white" style="background:#0f172a;border:1px solid rgba(99,102,241,0.4);">
              <div class="modal-header" style="border-color:rgba(99,102,241,0.3);padding:12px 16px;">
                <h5 class="modal-title fw-bold" style="font-size:0.95rem;">
                  <i class="fa-solid fa-user-circle" style="color:#a78bfa;"></i> Kelola Akun
                </h5>
                <button type="button" class="btn-close btn-close-white btn-sm" data-bs-dismiss="modal"></button>
              </div>
              <div class="modal-body" style="padding:14px;">

                <!-- Info Device -->
                <div style="background:rgba(99,102,241,0.1);border:1px solid rgba(99,102,241,0.25);border-radius:10px;padding:10px 12px;margin-bottom:12px;font-size:0.75rem;color:#94a3b8;">
                  <i class="fa-solid fa-mobile-screen" style="color:#6366f1;"></i>
                  Data tersimpan di <b style="color:#f8fafc;">perangkat ini</b> saja. Gunakan Export/Import untuk pindah device.
                </div>

                <!-- Daftar Akun -->
                <div style="font-size:0.78rem;color:#94a3b8;margin-bottom:6px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">
                  <i class="fa-solid fa-list"></i> Akun di Device Ini
                </div>
                <div id="account-list-container" style="margin-bottom:12px;display:flex;flex-direction:column;gap:6px;">
                </div>

                <!-- Buat Akun Baru -->
                <div id="create-account-section" style="display:none;margin-bottom:12px;">
                  <div style="font-size:0.78rem;color:#94a3b8;margin-bottom:6px;">Nama Akun Baru:</div>
                  <div style="display:flex;gap:6px;">
                    <input id="new-account-name" 
                      style="flex:1;background:rgba(15,23,42,0.8);border:1px solid rgba(255,255,255,0.15);border-radius:8px;color:white;padding:8px 10px;font-size:0.82rem;font-family:'Poppins',sans-serif;"
                      placeholder="Username..." maxlength="20">
                    <button onclick="confirmCreateAccount()" 
                      style="background:linear-gradient(135deg,#6366f1,#a855f7);border:none;color:white;padding:8px 12px;border-radius:8px;font-weight:700;font-size:0.78rem;font-family:'Poppins',sans-serif;cursor:pointer;white-space:nowrap;">
                      <i class="fa-solid fa-plus"></i> Buat
                    </button>
                  </div>
                  <div id="create-account-err" style="color:#ef4444;font-size:0.72rem;margin-top:4px;"></div>
                </div>

                <!-- Action Buttons -->
                <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;">
                  <button onclick="toggleCreateAccountSection()" id="btn-show-create"
                    style="flex:1;background:rgba(99,102,241,0.2);border:1px solid rgba(99,102,241,0.4);color:#a78bfa;padding:8px;border-radius:8px;font-size:0.78rem;font-weight:700;font-family:'Poppins',sans-serif;cursor:pointer;">
                    <i class="fa-solid fa-plus"></i> Akun Baru
                  </button>
                  <button onclick="saveCurrentNow()"
                    style="flex:1;background:rgba(52,211,153,0.15);border:1px solid rgba(52,211,153,0.3);color:#34d399;padding:8px;border-radius:8px;font-size:0.78rem;font-weight:700;font-family:'Poppins',sans-serif;cursor:pointer;">
                    <i class="fa-solid fa-floppy-disk"></i> Simpan
                  </button>
                </div>

                <!-- Divider -->
                <div style="border-top:1px solid rgba(255,255,255,0.07);margin:10px 0;"></div>

                <!-- Export / Import -->
                <div style="font-size:0.78rem;color:#94a3b8;margin-bottom:6px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">
                  <i class="fa-solid fa-arrows-left-right"></i> Backup / Pindah Device
                </div>
                <div style="display:flex;gap:6px;margin-bottom:8px;">
                  <button onclick="doExportAccount()"
                    style="flex:1;background:rgba(245,158,11,0.15);border:1px solid rgba(245,158,11,0.3);color:#f59e0b;padding:8px;border-radius:8px;font-size:0.78rem;font-weight:700;font-family:'Poppins',sans-serif;cursor:pointer;">
                    <i class="fa-solid fa-upload"></i> Export
                  </button>
                  <button onclick="toggleImportSection()"
                    style="flex:1;background:rgba(99,102,241,0.15);border:1px solid rgba(99,102,241,0.3);color:#a78bfa;padding:8px;border-radius:8px;font-size:0.78rem;font-weight:700;font-family:'Poppins',sans-serif;cursor:pointer;">
                    <i class="fa-solid fa-download"></i> Import
                  </button>
                </div>

                <!-- Import Area -->
                <div id="import-section" style="display:none;">
                  <textarea id="import-data-input"
                    style="width:100%;background:rgba(15,23,42,0.8);border:1px solid rgba(255,255,255,0.15);border-radius:8px;color:white;padding:8px;font-size:0.72rem;font-family:monospace;resize:none;height:70px;"
                    placeholder="Paste kode export di sini..."></textarea>
                  <button onclick="doImportAccount()"
                    style="width:100%;margin-top:6px;background:linear-gradient(135deg,#6366f1,#a855f7);border:none;color:white;padding:9px;border-radius:8px;font-weight:700;font-size:0.82rem;font-family:'Poppins',sans-serif;cursor:pointer;">
                    <i class="fa-solid fa-file-import"></i> Import Data
                  </button>
                  <div id="import-result" style="font-size:0.72rem;margin-top:4px;text-align:center;"></div>
                </div>

              </div>
            </div>
          </div>
        </div>
        `);
    }
}

// ── Render daftar akun di modal ──
function renderAccountList() {
    const container = document.getElementById('account-list-container');
    if (!container) return;
    const list = getAccountsList();
    const activeId = getActiveAccountId();

    if (!list.length) {
        container.innerHTML = `
          <div style="text-align:center;padding:14px;color:#64748b;font-size:0.82rem;">
            <i class="fa-solid fa-user-slash fa-2x d-block mb-2"></i>
            Belum ada akun. Buat akun baru!
          </div>`;
        return;
    }

    container.innerHTML = list.map(acc => {
        const isActive = acc.id === activeId;
        const lastActive = acc.lastActive ? new Date(acc.lastActive).toLocaleDateString('id-ID', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }) : '-';
        return `
        <div style="
          background:${isActive ? 'rgba(99,102,241,0.2)' : 'rgba(30,41,59,0.6)'};
          border:${isActive ? '2px solid rgba(99,102,241,0.6)' : '1px solid rgba(255,255,255,0.08)'};
          border-radius:10px;padding:10px 12px;
          display:flex;align-items:center;gap:8px;
          transition:all 0.2s;
        ">
          <div style="flex:1;min-width:0;">
            <div style="font-weight:700;font-size:0.85rem;color:${isActive ? '#a78bfa' : '#f8fafc'};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
              ${isActive ? '<i class="fa-solid fa-circle-check" style="color:#4ade80;"></i> ' : '<i class="fa-solid fa-user" style="color:#475569;"></i> '}
              ${acc.username}
            </div>
            <div style="font-size:0.65rem;color:#64748b;">
              <i class="fa-solid fa-gem" style="color:#a78bfa;"></i> ${(acc.gems||0).toLocaleString('id-ID')} Gems 
              &nbsp;·&nbsp; ${lastActive}
            </div>
          </div>
          <div style="display:flex;gap:4px;flex-shrink:0;">
            ${!isActive ? `
            <button onclick="confirmSwitchAccount('${acc.id}')"
              style="background:linear-gradient(135deg,#6366f1,#a855f7);border:none;color:white;padding:5px 10px;border-radius:6px;font-size:0.7rem;font-weight:700;font-family:'Poppins',sans-serif;cursor:pointer;">
              Login
            </button>` : `
            <span style="font-size:0.68rem;color:#4ade80;font-weight:700;padding:5px 6px;">AKTIF</span>
            `}
            <button onclick="confirmDeleteAccount('${acc.id}', '${acc.username}')"
              style="background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.3);color:#ef4444;padding:5px 8px;border-radius:6px;font-size:0.7rem;cursor:pointer;">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        </div>`;
    }).join('');
}

// ── Open account modal ──
function openAccountModal() {
    renderAccountList();
    // Reset sections
    const cs = document.getElementById('create-account-section');
    const is = document.getElementById('import-section');
    const ir = document.getElementById('import-result');
    if (cs) cs.style.display = 'none';
    if (is) is.style.display = 'none';
    if (ir) ir.textContent = '';
    const modal = new bootstrap.Modal(document.getElementById('accountModal'));
    modal.show();
}

function toggleCreateAccountSection() {
    const s = document.getElementById('create-account-section');
    s.style.display = s.style.display === 'none' ? 'block' : 'none';
    document.getElementById('create-account-err').textContent = '';
}

function toggleImportSection() {
    const s = document.getElementById('import-section');
    s.style.display = s.style.display === 'none' ? 'block' : 'none';
}

function confirmCreateAccount() {
    const name = document.getElementById('new-account-name').value.trim();
    const errEl = document.getElementById('create-account-err');
    if (!name) { errEl.textContent = 'Masukkan nama akun.'; return; }

    // Simpan akun aktif dulu sebelum buat baru
    const currentId = getActiveAccountId();
    if (currentId) saveGameData(currentId);

    const result = createNewAccount(name);
    if (result.error) { errEl.textContent = result.error; return; }

    // Switch ke akun baru & reset state game
    gems = 0; inventory = {}; enchantments = {};
    luckLevel = 0; luckExpiry = 0;
    lastFreePullDate = null; pendingTopupRequests = [];
    setActiveAccountId(result.account.id);
    localStorage.setItem('animegacha_playerName', name);
    updateGemsUI();
    updateAccountNameShort();
    renderAccountList();

    document.getElementById('create-account-section').style.display = 'none';
    document.getElementById('new-account-name').value = '';
    showToast(`✅ Akun <b>${name}</b> berhasil dibuat! Data baru dimulai.`, '#4ade80');
}

function confirmSwitchAccount(accountId) {
    const list = getAccountsList();
    const acc = list.find(a => a.id === accountId);
    if (!acc) return;
    if (confirm(`Ganti ke akun "${acc.username}"? Data akun sekarang akan disimpan otomatis.`)) {
        switchAccount(accountId);
        updateAccountNameShort();
        renderAccountList();
        // Re-render layar yang aktif
        const screens = ['inventory','shop','craft','auction'];
        screens.forEach(s => {
            if (document.getElementById(`screen-${s}`)?.classList.contains('active')) {
                switchScreen(s);
            }
        });
        showToast(`🔄 Beralih ke akun <b>${acc.username}</b>!`, '#a78bfa');
        bootstrap.Modal.getInstance(document.getElementById('accountModal'))?.hide();
    }
}

function confirmDeleteAccount(accountId, username) {
    if (confirm(`Hapus akun "${username}"?\n\n⚠️ Data akan dihapus PERMANEN dari device ini dan tidak bisa dipulihkan!`)) {
        deleteAccount(accountId);
        updateAccountNameShort();
        renderAccountList();
        showToast(`🗑️ Akun "${username}" dihapus.`, '#ef4444');
    }
}

function saveCurrentNow() {
    const id = getActiveAccountId();
    if (!id) { showToast('Tidak ada akun aktif!', '#ef4444'); return; }
    saveGameData(id);
    showToast('<i class="fa-solid fa-floppy-disk" style="color:#34d399;"></i> Data berhasil disimpan!', '#34d399');
}

function doExportAccount() {
    const code = exportAccountData();
    if (!code) { showToast('Tidak ada data untuk diekspor!', '#ef4444'); return; }
    // Copy ke clipboard
    if (navigator.clipboard) {
        navigator.clipboard.writeText(code).then(() => {
            showToast('📋 Kode export berhasil dicopy! Paste di device lain.', '#f59e0b');
        }).catch(() => showExportModal(code));
    } else {
        showExportModal(code);
    }
}

function showExportModal(code) {
    // Tampilkan code di textarea baru
    const existing = document.getElementById('export-code-modal');
    if (existing) existing.remove();
    document.body.insertAdjacentHTML('beforeend', `
    <div id="export-code-modal" style="
      position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:99999;
      display:flex;align-items:center;justify-content:center;padding:16px;
    " onclick="if(event.target===this)this.remove()">
      <div style="background:#1e293b;border-radius:14px;padding:16px;width:100%;max-width:400px;border:1px solid rgba(99,102,241,0.4);">
        <div style="font-weight:700;font-size:0.95rem;margin-bottom:8px;color:#f8fafc;">
          <i class="fa-solid fa-upload" style="color:#f59e0b;"></i> Kode Export Akun
        </div>
        <p style="font-size:0.78rem;color:#94a3b8;margin-bottom:8px;">Copy kode ini dan paste di device lain untuk import data kamu.</p>
        <textarea onclick="this.select()" readonly
          style="width:100%;background:#0f172a;border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#a78bfa;padding:8px;font-size:0.65rem;font-family:monospace;resize:none;height:80px;"
        >${code}</textarea>
        <button onclick="document.getElementById('export-code-modal').remove()"
          style="width:100%;margin-top:8px;background:rgba(99,102,241,0.3);border:1px solid rgba(99,102,241,0.4);color:white;padding:10px;border-radius:8px;font-weight:700;font-family:'Poppins',sans-serif;cursor:pointer;">
          Tutup
        </button>
      </div>
    </div>`);
}

function doImportAccount() {
    const code = document.getElementById('import-data-input').value.trim();
    const resultEl = document.getElementById('import-result');
    if (!code) { resultEl.style.color = '#ef4444'; resultEl.textContent = 'Masukkan kode export!'; return; }
    const result = importAccountData(code);
    if (result.error) {
        resultEl.style.color = '#ef4444';
        resultEl.textContent = result.error;
    } else {
        resultEl.style.color = '#4ade80';
        resultEl.textContent = `✅ Akun "${result.username}" berhasil diimport!`;
        document.getElementById('import-data-input').value = '';
        renderAccountList();
        showToast(`📥 Data akun "${result.username}" berhasil diimport!`, '#4ade80');
    }
}

function updateAccountNameShort() {
    const el = document.getElementById('account-name-short');
    if (!el) return;
    const id = getActiveAccountId();
    if (!id) { el.textContent = 'Akun'; return; }
    const list = getAccountsList();
    const acc = list.find(a => a.id === id);
    el.textContent = acc ? (acc.username.length > 8 ? acc.username.slice(0, 8) + '…' : acc.username) : 'Akun';
}

// ============================================================
//  INIT — dipanggil setelah halaman siap
// ============================================================
function initAccountSystem() {
    injectAccountUI();

    const activeId = getActiveAccountId();
    const list = getAccountsList();

    if (!activeId || !list.find(a => a.id === activeId)) {
        // Tidak ada akun aktif — cek apakah ada data lama (migrasi dari versi non-account)
        const oldName = localStorage.getItem('animegacha_playerName');
        if (list.length === 0) {
            // Buat akun default otomatis dari nama lama atau default
            const defaultName = oldName || 'Player_' + Math.floor(Math.random() * 9999);
            const result = createNewAccount(defaultName);
            if (result.success) {
                setActiveAccountId(result.account.id);
                // Tidak perlu load — state sudah 0/kosong dari awal
            }
        } else {
            // Ada akun tapi tidak ada yang aktif — pakai yang pertama
            switchAccount(list[0].id);
        }
    } else {
        // Ada akun aktif — load data
        loadGameData(activeId);
    }

    updateAccountNameShort();
    updateGemsUI();

    // Auto-save setiap 30 detik
    setInterval(() => {
        const id = getActiveAccountId();
        if (id) saveGameData(id);
    }, 30000);
}
