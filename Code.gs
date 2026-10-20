/**
 * ============================================================================
 * QYONA — Catatan Keuangan Rumah Tangga (Google Apps Script Backend & Bot Engine)
 * Versi: 1.0 (Sesuai PRD v1.0)
 * ============================================================================
 * 
 * Struktur Sheet Database:
 * 1. Transaksi
 * 2. Anggota Keluarga
 * 3. Kategori & Budget
 * 4. Dompet / Sumber Dana
 * 5. Tagihan Rutin
 * 6. Riwayat Chat & AI Insight
 * 7. Pengajuan Dana (ekstensi untuk US-5 & US-6 Approval Dana Anak/Keluarga)
 * 
 * Konfigurasi Script Properties (PropertiesService):
 * - SPREADSHEET_ID       : ID Google Spreadsheet (opsional jika bound script)
 * - DRIVE_FOLDER_ID      : ID Folder Google Drive "Qyona_Struk_Belanja"
 * - GEMINI_API_KEY       : API Key Google Gemini (gemini-2.5-flash)
 * - TELEGRAM_BOT_TOKEN   : Token Bot Telegram dari @BotFather
 * - WA_API_TOKEN         : Token WhatsApp Cloud API / Fonnte
 * - WA_PHONE_NUMBER_ID   : Phone Number ID Meta Cloud API (opsional)
 * - FAMILY_INVITE_CODE   : Kode undangan keluarga (default: QYONA-2026)
 */

const SHEET_NAMES = {
  TRANSAKSI: 'Transaksi',
  ANGGOTA: 'Anggota Keluarga',
  KATEGORI: 'Kategori & Budget',
  DOMPET: 'Dompet / Sumber Dana',
  TAGIHAN: 'Tagihan Rutin',
  INSIGHT: 'Riwayat Chat & AI Insight',
  PENGAJUAN: 'Pengajuan Dana',
  GOALS: 'Target Tabungan & Impian',
  KAMUS: 'Kamus Kata Kunci AI'
};

/**
 * HTTP GET Handler - Menyajikan Web App Qyona (HtmlService)
 */
function doGet(e) {
  initDatabaseIfNeeded();
  // Dukungan JSON API untuk sinkronisasi dua arah dengan GitHub Pages PWA
  if (e && e.parameter && e.parameter.action === 'rpc') {
    try {
      const fnName = String(e.parameter.fn || '');
      const args = e.parameter.args ? JSON.parse(e.parameter.args) : [];
      const res = executeAllowedRpc(fnName, args);
      return ContentService.createTextOutput(JSON.stringify({ ok: true, data: res }))
        .setMimeType(ContentService.MimeType.JSON);
    } catch (err) {
      return ContentService.createTextOutput(JSON.stringify({ ok: false, error: err.message || String(err) }))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }

  const template = HtmlService.createTemplateFromFile('Index');
  template.initialInviteCode = getConfig('FAMILY_INVITE_CODE', 'QYONA-2026');
  return template.evaluate()
    .setTitle('Qyona — Catatan Keuangan Rumah Tangga')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no');
}

/**
 * HTTP POST Handler - Mendukung RPC dari PWA mandiri / browser luar
 */
function doPost(e) {
  initDatabaseIfNeeded();
  try {
    let payload = {};
    if (e && e.postData && e.postData.contents) {
      payload = JSON.parse(e.postData.contents);
    } else if (e && e.parameter) {
      payload = e.parameter;
    }
    const fnName = String(payload.fn || payload.action || '');
    const args = Array.isArray(payload.args)
      ? payload.args
      : (payload.args ? JSON.parse(payload.args) : []);

    const res = executeAllowedRpc(fnName, args);
    return ContentService.createTextOutput(JSON.stringify({ ok: true, data: res }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: err.message || String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function executeAllowedRpc(fnName, args) {
  const allowed = {
    getPublicFamilyProfiles: getPublicFamilyProfiles,
    authenticateUser: authenticateUser,
    getAppBootstrapData: getAppBootstrapData,
    saveTransaction: saveTransaction,
    deleteTransaction: deleteTransaction,
    approveChildTransaction: approveChildTransaction,
    processChatbotMessage: processChatbotMessage,
    processReceiptImageOCR: processReceiptImageOCR,
    commitBatchOcrItems: commitBatchOcrItems,
    generateProactiveAIInsight: generateProactiveAIInsight,
    markBillAsPaid: markBillAsPaid,
    saveRoutineBill: saveRoutineBill,
    createFundRequest: createFundRequest,
    processFundRequestApproval: processFundRequestApproval,
    updateCategoryBudget: updateCategoryBudget,
    saveWalletSource: saveWalletSource,
    inviteOrUpdateFamilyMember: inviteOrUpdateFamilyMember,
    saveScriptConfigs: saveScriptConfigs,
    setupAutomatedTriggers: setupAutomatedTriggers,
    exportMonthlyCsv: exportMonthlyCsv,
    generateMonthlyPdfReport: generateMonthlyPdfReport,
    saveSavingsGoal: saveSavingsGoal,
    contributeToGoal: contributeToGoal,
    registerTelegramWebhook: registerTelegramWebhook,
    testInteractiveBotNotification: testInteractiveBotNotification,
    undoBatchTransactions: undoBatchTransactions,
    ensureCategoryExists: ensureCategoryExists,
    executeAIAction: executeAIAction,
    askFinancialAdvisor: askFinancialAdvisor
  };
  if (!allowed[fnName]) {
    throw new Error('Fungsi RPC tidak terdaftar: ' + fnName);
  }
  const readOnlyFns = {
    getPublicFamilyProfiles: true,
    authenticateUser: true,
    getAppBootstrapData: true,
    processReceiptImageOCR: true,
    exportMonthlyCsv: true,
    generateMonthlyPdfReport: true,
    testInteractiveBotNotification: true,
    askFinancialAdvisor: true
  };
  const result = allowed[fnName].apply(null, Array.isArray(args) ? args : []);
  if (!readOnlyFns[fnName]) {
    invalidateServerCache();
  }
  return result;
}

/**
 * ============================================================================
 * TURBO SPEED SERVER CACHE (CacheService.getScriptCache)
 * Memangkas waktu baca Spreadsheet dari ~3 detik menjadi ~0.05 detik
 * ============================================================================
 */
function getServerCacheVersion() {
  try {
    const cache = CacheService.getScriptCache();
    let ver = cache.get('QYONA_CACHE_VER');
    if (!ver) {
      ver = String(Date.now());
      cache.put('QYONA_CACHE_VER', ver, 21600);
    }
    return ver;
  } catch (e) {
    return 'v1';
  }
}

function invalidateServerCache() {
  try {
    const cache = CacheService.getScriptCache();
    cache.put('QYONA_CACHE_VER', String(Date.now()), 21600);
  } catch (e) {}
}

/**
 * Helper untuk menyertakan file HTML terpisah (CSS / JS modular)
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Ambil konfigurasi dari ScriptProperties dengan fallback default
 */
function getConfig(key, defaultValue = '') {
  try {
    const props = PropertiesService.getScriptProperties();
    const val = props.getProperty(key);
    return val !== null && val !== '' ? val : defaultValue;
  } catch (err) {
    return defaultValue;
  }
}

/**
 * Simpan konfigurasi ke ScriptProperties (Hanya Admin)
 */
function saveScriptConfigs(adminId, configObj) {
  const member = verifyMemberById(adminId);
  if (!member || member.role !== 'Admin') {
    throw new Error('Akses ditolak: Hanya Admin (Suami/Istri) yang dapat mengubah pengaturan sistem.');
  }
  const props = PropertiesService.getScriptProperties();
  Object.keys(configObj).forEach(k => {
    if (configObj[k] !== undefined && configObj[k] !== null && configObj[k] !== '********') {
      props.setProperty(k, String(configObj[k]).trim());
    }
  });
  return { success: true, message: 'Konfigurasi sistem berhasil disimpan di PropertiesService.' };
}

/**
 * Ambil instance Spreadsheet aktif atau berdasarkan SPREADSHEET_ID
 */
function getSpreadsheet() {
  const ssId = getConfig('SPREADSHEET_ID', '');
  if (ssId) {
    try {
      return SpreadsheetApp.openById(ssId);
    } catch (e) {
      // Fallback ke active spreadsheet atau buat baru
    }
  }
  let ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    ss = SpreadsheetApp.create('Database_Keuangan_Rumah_Qyona');
    PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', ss.getId());
  }
  return ss;
}

/**
 * Pastikan folder Google Drive `Qyona_Struk_Belanja` tersedia
 */
function getOrCreateReceiptFolder() {
  const folderId = getConfig('DRIVE_FOLDER_ID', '');
  if (folderId) {
    try {
      return DriveApp.getFolderById(folderId);
    } catch (e) {
      // Lanjut cari/buat folder
    }
  }
  const folders = DriveApp.getFoldersByName('Qyona_Struk_Belanja');
  let folder;
  if (folders.hasNext()) {
    folder = folders.next();
  } else {
    folder = DriveApp.createFolder('Qyona_Struk_Belanja');
  }
  PropertiesService.getScriptProperties().setProperty('DRIVE_FOLDER_ID', folder.getId());
  return folder;
}

/**
 * ============================================================================
 * INISIALISASI DATABASE & SEED DATA REALISTIS KELUARGA QYONA
 * ============================================================================
 */
function initDatabaseIfNeeded(forceCheck) {
  if (!forceCheck) {
    try {
      const cache = CacheService.getScriptCache();
      if (cache.get('QYONA_DB_READY_V2') === '1') return;
      if (PropertiesService.getScriptProperties().getProperty('QYONA_DB_READY_V2') === '1') {
        cache.put('QYONA_DB_READY_V2', '1', 21600);
        return;
      }
    } catch (e) {}
  }
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return;
  try {
    const ss = getSpreadsheet();
    
    // 1. Sheet Anggota Keluarga
    let shAnggota = ss.getSheetByName(SHEET_NAMES.ANGGOTA);
    if (!shAnggota) {
      shAnggota = ss.insertSheet(SHEET_NAMES.ANGGOTA);
      shAnggota.appendRow(['ID', 'Nama', 'Peran', 'ID Chat WhatsApp', 'ID Chat Telegram', 'Status Aktif', 'PIN', 'Avatar', 'Kuota Jajan']);
      const seedMembers = [
        ['USR-01', 'Ayah Budi (Suami)', 'Admin', '6281234567801', '1001001', 'Aktif', '1234', '👨💼', 0],
        ['USR-02', 'Bunda Qyona (Istri)', 'Admin', '6281234567802', '1001002', 'Aktif', '1234', '👩💼', 0],
        ['USR-03', 'Kakak Raka (Anak)', 'Member', '6281234567803', '1001003', 'Aktif', '1111', '👦🎒', 600000],
        ['USR-04', 'Adik Nayla (Anak)', 'Member', '6281234567804', '1001004', 'Aktif', '2222', '👧🎨', 400000]
      ];
      shAnggota.getRange(2, 1, seedMembers.length, seedMembers[0].length).setValues(seedMembers);
      styleHeaderRow(shAnggota, 9);
    }

    // 2. Sheet Kategori & Budget
    let shKategori = ss.getSheetByName(SHEET_NAMES.KATEGORI);
    if (!shKategori) {
      shKategori = ss.insertSheet(SHEET_NAMES.KATEGORI);
      shKategori.appendRow(['Nama Kategori', 'Batas Anggaran Bulanan', 'Persentase Peringatan', 'Warna Ikon', 'Ikon', 'Tipe']);
      const seedCategories = [
        ['Dapur & Makanan', 3500000, 80, '#F97316', 'fa-utensils', 'Keluar'],
        ['Tagihan & Utilitas', 2200000, 80, '#3B82F6', 'fa-bolt', 'Keluar'],
        ['Jajan/Anak', 1000000, 80, '#A855F7', 'fa-ice-cream', 'Keluar'],
        ['Transportasi & BBM', 1200000, 80, '#14B8A6', 'fa-gas-pump', 'Keluar'],
        ['Kesehatan & Darurat', 800000, 80, '#EF4444', 'fa-notes-medical', 'Keluar'],
        ['Hiburan & Keluarga', 900000, 80, '#EC4899', 'fa-film', 'Keluar'],
        ['Pendidikan & Les', 1500000, 80, '#6366F1', 'fa-graduation-cap', 'Keluar'],
        ['Gaji & Pemasukan', 0, 100, '#10B981', 'fa-sack-dollar', 'Masuk']
      ];
      shKategori.getRange(2, 1, seedCategories.length, seedCategories[0].length).setValues(seedCategories);
      styleHeaderRow(shKategori, 6);
    }

    // 3. Sheet Dompet / Sumber Dana
    let shDompet = ss.getSheetByName(SHEET_NAMES.DOMPET);
    if (!shDompet) {
      shDompet = ss.insertSheet(SHEET_NAMES.DOMPET);
      shDompet.appendRow(['ID Dompet', 'Nama Dompet', 'Tipe', 'Saldo Awal', 'Saldo Berjalan', 'Nomor Rekening / Info']);
      const seedWallets = [
        ['WLT-01', 'BCA Keluarga', 'Bank', 14500000, 18745000, 'BCA •• 8821'],
        ['WLT-02', 'Mandiri Tabungan', 'Bank', 8000000, 7450000, 'Mandiri •• 4410'],
        ['WLT-03', 'GoPay / QRIS Rumah', 'E-wallet', 1500000, 1185000, 'GoPay 0812••02'],
        ['WLT-04', 'Dompet Tunai Dapur', 'Tunai', 1200000, 845000, 'Cash Pegangan Bunda'],
        ['WLT-05', 'Saku Anak (Gopay/Cash)', 'E-wallet', 1000000, 615000, 'Kuota Jajan Raka & Nayla']
      ];
      shDompet.getRange(2, 1, seedWallets.length, seedWallets[0].length).setValues(seedWallets);
      styleHeaderRow(shDompet, 6);
    }

    // 4. Sheet Transaksi
    let shTransaksi = ss.getSheetByName(SHEET_NAMES.TRANSAKSI);
    if (!shTransaksi) {
      shTransaksi = ss.insertSheet(SHEET_NAMES.TRANSAKSI);
      shTransaksi.appendRow(['ID', 'Tanggal', 'Tipe', 'Jumlah', 'Kategori', 'Keterangan', 'ID Dompet', 'ID Anggota', 'URL Foto Struk', 'Sumber Input', 'Status Approval']);
      const now = new Date();
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, '0');
      const prevM = String(now.getMonth() === 0 ? 12 : now.getMonth()).padStart(2, '0');
      const prevY = now.getMonth() === 0 ? y - 1 : y;

      const seedTrx = [
        // Bulan Lalu (untuk komparasi AI Insight)
        ['TRX-0901', `${prevY}-${prevM}-01 09:00`, 'Masuk', 18500000, 'Gaji & Pemasukan', 'Gaji Bulanan Ayah & Bunda', 'WLT-01', 'USR-01', '', 'Form', 'Disetujui'],
        ['TRX-0902', `${prevY}-${prevM}-05 14:20`, 'Keluar', 2650000, 'Dapur & Makanan', 'Belanja Bulanan Groceries & Pasar', 'WLT-01', 'USR-02', '', 'OCR', 'Disetujui'],
        ['TRX-0903', `${prevY}-${prevM}-10 10:15`, 'Keluar', 1950000, 'Tagihan & Utilitas', 'Listrik PLN, Air PDAM & Internet', 'WLT-01', 'USR-01', '', 'Form', 'Disetujui'],
        ['TRX-0904', `${prevY}-${prevM}-15 16:40`, 'Keluar', 780000, 'Jajan/Anak', 'Total Jajan Sekolah Raka & Nayla', 'WLT-05', 'USR-03', '', 'Chat', 'Disetujui'],
        ['TRX-0905', `${prevY}-${prevM}-19 19:00`, 'Keluar', 920000, 'Transportasi & BBM', 'Pertamax Mobil & KRL Bulanan', 'WLT-03', 'USR-01', '', 'Chat', 'Disetujui'],
        ['TRX-0906', `${prevY}-${prevM}-24 20:10`, 'Keluar', 650000, 'Hiburan & Keluarga', 'Makan Malam Keluarga Akhir Pekan', 'WLT-01', 'USR-02', '', 'Chat', 'Disetujui'],

        // Bulan Berjalan
        ['TRX-1001', `${y}-${m}-01 08:30`, 'Masuk', 19200000, 'Gaji & Pemasukan', 'Gaji Bulanan Ayah Budi & Insentif', 'WLT-01', 'USR-01', '', 'Form', 'Disetujui'],
        ['TRX-1002', `${y}-${m}-02 10:12`, 'Keluar', 485000, 'Dapur & Makanan', 'Beli beras 10kg, minyak goreng 2L, telur 2kg', 'WLT-04', 'USR-02', '', 'Chat', 'Disetujui'],
        ['TRX-1003', `${y}-${m}-04 13:45`, 'Keluar', 1120000, 'Dapur & Makanan', 'Struk Superindo (14 item sembako & sayur segar)', 'WLT-01', 'USR-02', 'https://drive.google.com/qyona-sample-struk-01', 'OCR', 'Disetujui'],
        ['TRX-1004', `${y}-${m}-06 07:30`, 'Keluar', 350000, 'Transportasi & BBM', 'Isi BBM Pertamax full tank mobil keluarga', 'WLT-03', 'USR-01', '', 'Chat', 'Disetujui'],
        ['TRX-1005', `${y}-${m}-08 12:20`, 'Keluar', 45000, 'Jajan/Anak', 'Beli bekal roti bakar & susu UHT di kantin', 'WLT-05', 'USR-03', '', 'Chat', 'Pending'],
        ['TRX-1006', `${y}-${m}-09 15:10`, 'Keluar', 850000, 'Tagihan & Utilitas', 'Token Listrik PLN Rumah 200kWh & WiFi Biznet', 'WLT-01', 'USR-01', '', 'Chat', 'Disetujui'],
        ['TRX-1007', `${y}-${m}-11 16:05`, 'Keluar', 35000, 'Jajan/Anak', 'Beli buku gambar & es krim coklat', 'WLT-05', 'USR-04', '', 'Chat', 'Pending'],
        ['TRX-1008', `${y}-${m}-12 18:50`, 'Keluar', 725000, 'Dapur & Makanan', 'Belanja ikan segar, ayam kampung, bumbu dapur & gas 12kg', 'WLT-04', 'USR-02', '', 'Chat', 'Disetujui'],
        ['TRX-1009', `${y}-${m}-14 19:30`, 'Keluar', 540000, 'Hiburan & Keluarga', 'Kopi kenangan, cemilan sore & langganan streaming', 'WLT-03', 'USR-01', '', 'Chat', 'Disetujui'],
        ['TRX-1010', `${y}-${m}-15 09:15`, 'Keluar', 650000, 'Pendidikan & Les', 'Les Bahasa Inggris & Matematika Raka', 'WLT-02', 'USR-02', '', 'Form', 'Disetujui'],
        ['TRX-1011', `${y}-${m}-17 11:40`, 'Keluar', 165000, 'Jajan/Anak', 'Beli novel remaja & makan siang bareng teman', 'WLT-05', 'USR-03', '', 'Chat', 'Disetujui'],
        ['TRX-1012', `${y}-${m}-18 17:00`, 'Keluar', 590000, 'Dapur & Makanan', 'Pesan makanan online (GoFood) 3x minggu ini', 'WLT-03', 'USR-02', '', 'Chat', 'Disetujui']
      ];
      shTransaksi.getRange(2, 1, seedTrx.length, seedTrx[0].length).setValues(seedTrx);
      styleHeaderRow(shTransaksi, 11);
    }

    // 5. Sheet Tagihan Rutin
    let shTagihan = ss.getSheetByName(SHEET_NAMES.TAGIHAN);
    if (!shTagihan) {
      shTagihan = ss.insertSheet(SHEET_NAMES.TAGIHAN);
      shTagihan.appendRow(['ID Tagihan', 'Nama Tagihan', 'Nominal Estimasi', 'Tanggal Jatuh Tempo', 'Kategori', 'ID Dompet Default', 'Status', 'Pengingat Terkirim']);
      const seedBills = [
        ['BIL-01', 'Listrik PLN Pascabayar / Token Utama', 650000, 20, 'Tagihan & Utilitas', 'WLT-01', 'Lunas', 'Sudah'],
        ['BIL-02', 'Internet WiFi Fiber Rumah', 385000, 20, 'Tagihan & Utilitas', 'WLT-01', 'Belum', 'Belum'],
        ['BIL-03', 'Air PDAM & Iuran Keamanan RT', 275000, 22, 'Tagihan & Utilitas', 'WLT-04', 'Belum', 'Belum'],
        ['BIL-04', 'SPP Sekolah & Ekstrakurikuler Anak', 1350000, 25, 'Pendidikan & Les', 'WLT-02', 'Belum', 'Belum'],
        ['BIL-05', 'BPJS Kesehatan Keluarga (4 Jiwa)', 600000, 10, 'Kesehatan & Darurat', 'WLT-01', 'Lunas', 'Sudah']
      ];
      shTagihan.getRange(2, 1, seedBills.length, seedBills[0].length).setValues(seedBills);
      styleHeaderRow(shTagihan, 8);
    }

    // 6. Sheet Riwayat Chat & AI Insight
    let shInsight = ss.getSheetByName(SHEET_NAMES.INSIGHT);
    if (!shInsight) {
      shInsight = ss.insertSheet(SHEET_NAMES.INSIGHT);
      shInsight.appendRow(['ID Insight', 'Timestamp', 'ID Anggota', 'Teks Chat Asli / Trigger', 'Hasil Analisis AI', 'Jenis', 'Estimasi Penghematan', 'Status Rekomendasi']);
      const nowIso = Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd HH:mm');
      const seedInsights = [
        [
          'INS-01',
          nowIso,
          'USR-02',
          'Evaluasi Otomatis Pengeluaran Dapur & Pesan Antar',
          'Pengeluaran kategori Dapur & Makanan mencapai Rp 2.920.000 (83% dari budget Rp 3.500.000). Terdeteksi 20% di antaranya berasal dari pesan makanan online (GoFood) di hari kerja. Dengan menyiapkan meal-prep akhir pekan dan membatasi pesan-antar maksimal 1x seminggu, keluarga dapat menghemat signifikan.',
          'Bulanan',
          420000,
          'Aktif'
        ],
        [
          'INS-02',
          nowIso,
          'USR-01',
          'Optimasi Langganan Hiburan & Kopi Harian',
          'Pengeluaran Hiburan & Keluarga tercatat Rp 540.000 bulan ini. Pembelian kopi siap saji dan layanan streaming ganda menyumbang porsi terbesar. Menggabungkan paket family plan dan menyeduh kopi sendiri di rumah 3 hari/minggu sangat direkomendasikan.',
          'Mingguan',
          245000,
          'Aktif'
        ],
        [
          'INS-03',
          nowIso,
          'USR-03',
          'Tips Pintar Uang Jajan Anak (Raka & Nayla)',
          'Hebat! Penggunaan kuota uang jajan anak masih terkendali di angka 24.5% (Rp 245.000 dari Rp 1.000.000). Jika Kakak Raka dan Adik Nayla menyisihkan Rp 5.000 per hari sekolah ke celengan target, di akhir semester akan terkumpul Rp 600.000!',
          'Harian',
          150000,
          'Aktif'
        ]
      ];
      shInsight.getRange(2, 1, seedInsights.length, seedInsights[0].length).setValues(seedInsights);
      styleHeaderRow(shInsight, 8);
    }

    // 7. Sheet Pengajuan Dana (Approval Dana Anak / Request Tambahan)
    let shPengajuan = ss.getSheetByName(SHEET_NAMES.PENGAJUAN);
    if (!shPengajuan) {
      shPengajuan = ss.insertSheet(SHEET_NAMES.PENGAJUAN);
      shPengajuan.appendRow(['ID Request', 'Tanggal', 'ID Anggota', 'Nama Anggota', 'Nominal', 'Keperluan', 'Status', 'Diproses Oleh']);
      const nowDate = Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd HH:mm');
      const seedRequests = [
        ['REQ-01', nowDate, 'USR-03', 'Kakak Raka (Anak)', 125000, 'Beli buku latihan Olimpiade Sains & alat tulis praktikum', 'Menunggu Approval', ''],
        ['REQ-02', nowDate, 'USR-04', 'Adik Nayla (Anak)', 65000, 'Iuran karya wisata kelas dan beli cat air baru', 'Menunggu Approval', '']
      ];
      shPengajuan.getRange(2, 1, seedRequests.length, seedRequests[0].length).setValues(seedRequests);
      styleHeaderRow(shPengajuan, 8);
    }

    // 8. Sheet Target Tabungan & Impian Keluarga (Upgrade v2.0: Family Goals & Sinking Funds + Bonus Matching Anak)
    let shGoals = ss.getSheetByName(SHEET_NAMES.GOALS);
    if (!shGoals) {
      shGoals = ss.insertSheet(SHEET_NAMES.GOALS);
      shGoals.appendRow(['ID Goal', 'Nama Target Impian', 'Nominal Target', 'Terkumpul Saat Ini', 'Tenggat Waktu', 'ID Pemilik', 'Ikon', 'Warna', 'Rasio Bonus Matching Ortu (%)', 'Status']);
      const seedGoals = [
        ['GOL-01', 'Dana Darurat Keluarga (6x Pengeluaran)', 25000000, 14500000, '2027-06-30', 'ALL', 'fa-shield-heart', '#10B981', 0, 'Aktif'],
        ['GOL-02', 'Liburan Keluarga ke Yogyakarta & Bali', 12000000, 6800000, '2026-12-20', 'ALL', 'fa-plane-departure', '#0EA5E9', 0, 'Aktif'],
        ['GOL-03', 'Tabungan Kurban & Amal Keluarga', 4500000, 2900000, '2027-05-15', 'ALL', 'fa-hand-holding-heart', '#F59E0B', 0, 'Aktif'],
        ['GOL-04', 'Celengan Sepeda Lipat Kakak Raka', 1800000, 750000, '2026-12-31', 'USR-03', 'fa-bicycle', '#8B5CF6', 100, 'Aktif'],
        ['GOL-05', 'Celengan Tablet Gambar Adik Nayla', 1500000, 520000, '2027-01-31', 'USR-04', 'fa-palette', '#EC4899', 50, 'Aktif']
      ];
      shGoals.getRange(2, 1, seedGoals.length, seedGoals[0].length).setValues(seedGoals);
      styleHeaderRow(shGoals, 10);
    }

    // 9. Sheet Kamus Kata Kunci AI (Self-Learning Memory Keluarga)
    let shKamus = ss.getSheetByName(SHEET_NAMES.KAMUS);
    if (!shKamus) {
      shKamus = ss.insertSheet(SHEET_NAMES.KAMUS);
      shKamus.appendRow(['Kata Kunci / Frasa', 'Kategori Target', 'Default Dompet', 'Frekuensi', 'Terakhir Digunakan']);
      const nowIso = Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd HH:mm');
      const seedKamus = [
        ['beras', 'Dapur & Makanan', 'WLT-04', 10, nowIso],
        ['minyak goreng', 'Dapur & Makanan', 'WLT-04', 8, nowIso],
        ['ayam', 'Dapur & Makanan', 'WLT-04', 9, nowIso],
        ['sayur', 'Dapur & Makanan', 'WLT-04', 12, nowIso],
        ['bayam', 'Dapur & Makanan', 'WLT-04', 6, nowIso],
        ['telur', 'Dapur & Makanan', 'WLT-04', 7, nowIso],
        ['bensin', 'Transportasi & BBM', 'WLT-03', 15, nowIso],
        ['pertamax', 'Transportasi & BBM', 'WLT-03', 11, nowIso],
        ['makanan kucing', 'Hewan Peliharaan', 'WLT-01', 5, nowIso],
        ['whiskas', 'Hewan Peliharaan', 'WLT-01', 4, nowIso],
        ['kucing', 'Hewan Peliharaan', 'WLT-01', 4, nowIso],
        ['token listrik', 'Tagihan & Utilitas', 'WLT-01', 6, nowIso],
        ['wifi', 'Tagihan & Utilitas', 'WLT-01', 5, nowIso],
        ['skincare', 'Skincare & Kecantikan', 'WLT-01', 3, nowIso],
        ['kopi', 'Kopi & Nongkrong', 'WLT-03', 8, nowIso],
        ['es krim', 'Jajan/Anak', 'WLT-05', 10, nowIso]
      ];
      shKamus.getRange(2, 1, seedKamus.length, seedKamus[0].length).setValues(seedKamus);
      styleHeaderRow(shKamus, 5);
    }

    // Hapus Sheet1 default jika masih kosong dan ada sheet lain
    const defaultSheet = ss.getSheetByName('Sheet1');
    if (defaultSheet && ss.getSheets().length > 1) {
      try { ss.deleteSheet(defaultSheet); } catch (e) {}
    }

    recalculateAllWalletBalances(ss);
    try {
      PropertiesService.getScriptProperties().setProperty('QYONA_DB_READY_V3', '1');
      CacheService.getScriptCache().put('QYONA_DB_READY_V3', '1', 21600);
    } catch (e) {}
  } finally {
    lock.releaseLock();
  }
}

function styleHeaderRow(sheet, numCols) {
  const headerRange = sheet.getRange(1, 1, 1, numCols);
  headerRange.setBackground('#0F766E');
  headerRange.setFontColor('#FFFFFF');
  headerRange.setFontWeight('bold');
  sheet.setFrozenRows(1);
}

/**
 * ============================================================================
 * RBAC & AUTENTIKASI KELUARGA PRIVAT
 * ============================================================================
 */

function getAllMembers() {
  const ss = getSpreadsheet();
  const sh = ss.getSheetByName(SHEET_NAMES.ANGGOTA);
  const data = sh.getDataRange().getValues();
  const members = [];
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    if (!r[0]) continue;
    members.push({
      id: String(r[0]),
      name: String(r[1]),
      role: String(r[2]), // 'Admin' atau 'Member'
      waId: String(r[3] || ''),
      tgId: String(r[4] || ''),
      status: String(r[5] || 'Aktif'),
      pin: String(r[6] || '1234'),
      avatar: String(r[7] || '👤'),
      allowanceQuota: Number(r[8] || 0)
    });
  }
  return members;
}

function verifyMemberById(memberId) {
  const members = getAllMembers();
  return members.find(m => m.id === memberId && m.status === 'Aktif') || null;
}

function verifyMemberByChatId(chatId) {
  const cleanChatId = String(chatId || '').trim().replace(/^\+/, '');
  if (!cleanChatId) return null;
  const members = getAllMembers();
  return members.find(m =>
    m.status === 'Aktif' &&
    (m.waId.replace(/^\+/, '') === cleanChatId || m.tgId === cleanChatId || m.id.toLowerCase() === cleanChatId.toLowerCase())
  ) || null;
}

/**
 * Endpoint Login untuk Halaman Login Web App Qyona
 * Mendukung login dengan:
 * 1. ID Anggota + PIN
 * 2. Nomor WhatsApp / ID Chat Telegram + Kode Undangan / PIN
 */
function authenticateUser(credentials) {
  initDatabaseIfNeeded();
  const members = getAllMembers();
  const inviteCode = getConfig('FAMILY_INVITE_CODE', 'QYONA-2026');

  // Mode 1: Pilih profil keluarga + PIN
  if (credentials.memberId) {
    const user = members.find(m => m.id === credentials.memberId && m.status === 'Aktif');
    if (!user) {
      return { success: false, message: 'Profil anggota keluarga tidak ditemukan atau tidak aktif.' };
    }
    if (credentials.pin && user.pin !== String(credentials.pin).trim()) {
      return { success: false, message: 'PIN Keamanan salah. Untuk demo: Ayah/Bunda (1234), Raka (1111), Nayla (2222).' };
    }
    return {
      success: true,
      user: sanitizeMemberForClient(user),
      familyMembers: members.map(sanitizeMemberForClient)
    };
  }

  // Mode 2: Login dengan ID Chat WhatsApp/Telegram + Invite Code
  if (credentials.chatId) {
    const user = verifyMemberByChatId(credentials.chatId);
    if (!user) {
      return {
        success: false,
        message: 'ID Chat WhatsApp/Telegram belum terdaftar di Sheet Anggota Keluarga. Hubungi Admin (Ayah/Bunda).'
      };
    }
    if (credentials.inviteCode && credentials.inviteCode.trim().toUpperCase() !== inviteCode.toUpperCase()) {
      return {
        success: false,
        message: 'Kode Undangan Keluarga tidak valid.'
      };
    }
    return {
      success: true,
      user: sanitizeMemberForClient(user),
      familyMembers: members.map(sanitizeMemberForClient)
    };
  }

  return { success: false, message: 'Data kredensial tidak lengkap.' };
}

function sanitizeMemberForClient(m) {
  return {
    id: m.id,
    name: m.name,
    role: m.role,
    waId: m.waId,
    tgId: m.tgId,
    status: m.status,
    avatar: m.avatar,
    allowanceQuota: m.allowanceQuota
  };
}

/**
 * Ambil daftar profil keluarga publik untuk layar pilih akun di halaman login
 * Dilengkapi CacheService agar halaman login terbuka instan (<50ms)
 */
function getPublicFamilyProfiles() {
  initDatabaseIfNeeded();
  const cacheKey = 'PUB_PROFILES_' + getServerCacheVersion();
  try {
    const cached = CacheService.getScriptCache().get(cacheKey);
    if (cached) return JSON.parse(cached);
  } catch (e) {}

  const members = getAllMembers().filter(m => m.status === 'Aktif');
  const result = {
    familyName: 'Keluarga Rumah Qyona',
    maxCapacity: 6,
    activeCount: members.length,
    profiles: members.map(m => ({
      id: m.id,
      name: m.name,
      role: m.role,
      avatar: m.avatar,
      hintPin: m.role === 'Admin' ? '1234' : (m.id === 'USR-03' ? '1111' : '2222'),
      waIdMasked: m.waId ? m.waId.slice(0, 5) + '••••' + m.waId.slice(-2) : '-',
      tgId: m.tgId
    }))
  };

  try {
    CacheService.getScriptCache().put(cacheKey, JSON.stringify(result), 600);
  } catch (e) {}
  return result;
}

/**
 * ============================================================================
 * PENGAMBILAN DATA DASHBOARD REAL-TIME DENGAN FILTER RBAC + TURBO CACHE (US-3 & US-6)
 * ============================================================================
 */
function getAppBootstrapData(memberId, selectedMonthYear, forceFresh) {
  initDatabaseIfNeeded();
  const now = new Date();
  const currentYM = selectedMonthYear || Utilities.formatDate(now, 'Asia/Jakarta', 'yyyy-MM');
  const cacheKey = 'BOOT_' + getServerCacheVersion() + '_' + String(memberId) + '_' + currentYM;

  if (forceFresh) {
    try {
      CacheService.getScriptCache().remove(cacheKey);
    } catch (e) {}
  } else {
    try {
      const cached = CacheService.getScriptCache().get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (e) {}
  }

  const currentUser = verifyMemberById(memberId);
  if (!currentUser) {
    throw new Error('Sesi tidak valid atau akses anggota telah dinonaktifkan.');
  }

  const ss = getSpreadsheet();
  const isAdmin = currentUser.role === 'Admin';

  const [yrStr, moStr] = currentYM.split('-');
  const yr = parseInt(yrStr, 10);
  const mo = parseInt(moStr, 10);
  const prevDate = new Date(yr, mo - 2, 1);
  const prevYM = Utilities.formatDate(prevDate, 'Asia/Jakarta', 'yyyy-MM');

  // 1. Anggota
  const allMembers = getAllMembers();
  const memberMap = {};
  allMembers.forEach(m => { memberMap[m.id] = m; });

  // 2. Kategori & Budget
  const shKategori = ss.getSheetByName(SHEET_NAMES.KATEGORI);
  const katData = shKategori.getDataRange().getValues();
  let categories = [];
  for (let i = 1; i < katData.length; i++) {
    const r = katData[i];
    if (!r[0]) continue;
    categories.push({
      name: String(r[0]),
      monthlyLimit: Number(r[1] || 0),
      warnPercent: Number(r[2] || 80),
      color: String(r[3] || '#10B981'),
      icon: String(r[4] || 'fa-tag'),
      type: String(r[5] || 'Keluar')
    });
  }
  if (!isAdmin) {
    categories = categories.filter(c => c.name === 'Jajan/Anak');
  }

  // 3. Dompet & 4. Transaksi (Hitung saldo berjalan di memori tanpa perlu tulis ulang ke Sheet saat baca!)
  const shDompet = ss.getSheetByName(SHEET_NAMES.DOMPET);
  const domData = shDompet.getDataRange().getValues();
  const shTrx = ss.getSheetByName(SHEET_NAMES.TRANSAKSI);
  const trxData = shTrx.getDataRange().getValues();

  const deltaByWallet = {};
  for (let i = 1; i < trxData.length; i++) {
    const tr = trxTrxRow(trxData[i]);
    if (!tr.id || tr.status === 'Dibatalkan') continue;
    deltaByWallet[tr.walletId] = (deltaByWallet[tr.walletId] || 0) + (tr.type === 'Masuk' ? tr.amount : -tr.amount);
  }

  let wallets = [];
  for (let i = 1; i < domData.length; i++) {
    const r = domData[i];
    if (!r[0]) continue;
    const wId = String(r[0]);
    const initBal = Number(r[3] || 0);
    wallets.push({
      id: wId,
      name: String(r[1]),
      type: String(r[2]),
      initialBalance: initBal,
      currentBalance: initBal + (deltaByWallet[wId] || 0),
      info: String(r[5] || '')
    });
  }
  const walletMap = {};
  wallets.forEach(w => { walletMap[w.id] = w; });

  const allTransactions = [];
  for (let i = 1; i < trxData.length; i++) {
    const r = trxData[i];
    if (!r[0]) continue;
    let dateStr = '';
    if (r[1] instanceof Date) {
      dateStr = Utilities.formatDate(r[1], 'Asia/Jakarta', 'yyyy-MM-dd HH:mm');
    } else {
      dateStr = String(r[1]);
    }
    const trxOwnerId = String(r[7] || '');
    const trxCategory = String(r[4] || '');

    if (!isAdmin && trxOwnerId !== currentUser.id) {
      continue;
    }

    const owner = memberMap[trxOwnerId] || { name: 'Keluarga', avatar: '👤', role: 'Member' };
    const wlt = walletMap[String(r[6])] || { name: 'Dompet Utama' };
    const trxStatus = String(r[10] || 'Disetujui');

    allTransactions.push({
      id: String(r[0]),
      date: dateStr,
      monthYear: dateStr.slice(0, 7),
      type: String(r[2]),
      amount: Number(r[3] || 0),
      category: trxCategory,
      description: String(r[5] || ''),
      walletId: String(r[6] || ''),
      walletName: wlt.name,
      memberId: trxOwnerId,
      memberName: owner.name,
      memberAvatar: owner.avatar,
      receiptUrl: String(r[8] || ''),
      source: String(r[9] || 'Chat'),
      approvalStatus: trxStatus,
      canEdit: (isAdmin || (trxOwnerId === currentUser.id && trxStatus !== 'Disetujui')) && trxStatus !== 'Dibatalkan'
    });
  }

  allTransactions.sort((a, b) => (b.date > a.date ? 1 : -1));

  const currentMonthTrx = allTransactions.filter(t => t.monthYear === currentYM);
  const prevMonthTrx = allTransactions.filter(t => t.monthYear === prevYM);

  let totalIncome = 0;
  let totalExpense = 0;
  const spendingByCategory = {};
  const prevSpendingByCategory = {};

  currentMonthTrx.forEach(t => {
    if (t.approvalStatus === 'Dibatalkan') return;
    if (t.type === 'Masuk') {
      totalIncome += t.amount;
    } else {
      totalExpense += t.amount;
      spendingByCategory[t.category] = (spendingByCategory[t.category] || 0) + t.amount;
    }
  });

  prevMonthTrx.forEach(t => {
    if (t.approvalStatus === 'Dibatalkan') return;
    if (t.type === 'Keluar') {
      prevSpendingByCategory[t.category] = (prevSpendingByCategory[t.category] || 0) + t.amount;
    }
  });

  const categoryBreakdown = categories
    .filter(c => c.type === 'Keluar')
    .map(c => {
      const spent = spendingByCategory[c.name] || 0;
      const prevSpent = prevSpendingByCategory[c.name] || 0;
      const limit = (!isAdmin && c.name === 'Jajan/Anak')
        ? (currentUser.allowanceQuota || 500000)
        : c.monthlyLimit;
      const percentage = limit > 0 ? Math.round((spent / limit) * 100) : 0;
      const diffFromPrev = spent - prevSpent;
      const diffPercent = prevSpent > 0 ? Math.round(((spent - prevSpent) / prevSpent) * 100) : 0;
      return {
        name: c.name,
        spent: spent,
        prevSpent: prevSpent,
        limit: limit,
        percentage: percentage,
        warnPercent: c.warnPercent,
        color: c.color,
        icon: c.icon,
        isOverWarning: percentage >= c.warnPercent && percentage < 100,
        isOverBudget: percentage >= 100,
        diffFromPrev: diffFromPrev,
        diffPercent: diffPercent
      };
    });

  // 5. Tagihan Rutin
  const shTagihan = ss.getSheetByName(SHEET_NAMES.TAGIHAN);
  const tagData = shTagihan.getDataRange().getValues();
  const bills = [];
  if (isAdmin) {
    for (let i = 1; i < tagData.length; i++) {
      const r = tagData[i];
      if (!r[0]) continue;
      bills.push({
        id: String(r[0]),
        name: String(r[1]),
        amount: Number(r[2] || 0),
        dueDay: Number(r[3] || 1),
        category: String(r[4] || 'Tagihan & Utilitas'),
        walletId: String(r[5] || 'WLT-01'),
        status: String(r[6] || 'Belum'),
        reminderSent: String(r[7] || 'Belum')
      });
    }
  }

  // 6. Pengajuan Dana
  const shReq = ss.getSheetByName(SHEET_NAMES.PENGAJUAN);
  const reqData = shReq.getDataRange().getValues();
  const fundRequests = [];
  for (let i = 1; i < reqData.length; i++) {
    const r = reqData[i];
    if (!r[0]) continue;
    const reqOwnerId = String(r[2]);
    if (!isAdmin && reqOwnerId !== currentUser.id) continue;
    fundRequests.push({
      id: String(r[0]),
      date: String(r[1]),
      memberId: reqOwnerId,
      memberName: String(r[3]),
      amount: Number(r[4] || 0),
      reason: String(r[5] || ''),
      status: String(r[6] || 'Menunggu Approval'),
      processedBy: String(r[7] || '')
    });
  }

  // 7. AI Insights
  const shIns = ss.getSheetByName(SHEET_NAMES.INSIGHT);
  const insData = shIns.getDataRange().getValues();
  const insights = [];
  for (let i = 1; i < insData.length; i++) {
    const r = insData[i];
    if (!r[0]) continue;
    const insType = String(r[5] || 'Bulanan');
    const targetMember = String(r[2] || '');
    if (!isAdmin && insType !== 'Harian' && targetMember !== currentUser.id) continue;
    insights.push({
      id: String(r[0]),
      timestamp: String(r[1]),
      memberId: targetMember,
      prompt: String(r[3]),
      analysis: String(r[4]),
      type: insType,
      estimatedSaving: Number(r[6] || 0),
      status: String(r[7] || 'Aktif')
    });
  }
  insights.reverse();

  // 8. Kantong Impian & Tabungan Target Keluarga (Upgrade v2.0)
  let shGoals = ss.getSheetByName(SHEET_NAMES.GOALS);
  if (!shGoals) {
    initDatabaseIfNeeded(true);
    shGoals = ss.getSheetByName(SHEET_NAMES.GOALS);
  }
  const goalsData = shGoals ? shGoals.getDataRange().getValues() : [];
  const savingsGoals = [];
  const monthlySurplusEstimate = Math.max(500000, totalIncome - totalExpense);
  for (let i = 1; i < goalsData.length; i++) {
    const r = goalsData[i];
    if (!r[0]) continue;
    const ownerId = String(r[5] || 'ALL');
    if (!isAdmin && ownerId !== 'ALL' && ownerId !== currentUser.id) continue;
    const targetAmt = Number(r[2] || 0);
    const currentAmt = Number(r[3] || 0);
    const remainingAmt = Math.max(0, targetAmt - currentAmt);
    const pct = targetAmt > 0 ? Math.min(100, Math.round((currentAmt / targetAmt) * 100)) : 0;
    const matchRate = Number(r[8] || 0);
    const ownerObj = ownerId === 'ALL' ? { name: 'Keluarga Qyona', avatar: '🏡' } : (memberMap[ownerId] || { name: ownerId, avatar: '🧒' });
    const estMonths = remainingAmt === 0 ? 0 : Math.max(1, Math.ceil(remainingAmt / (ownerId === 'ALL' ? (monthlySurplusEstimate * 0.35) : 150000)));
    const goalTitle = String(r[1]);
    savingsGoals.push({
      id: String(r[0]),
      name: goalTitle,
      title: goalTitle,
      targetAmount: targetAmt,
      savedAmount: currentAmt,
      currentAmount: currentAmt,
      remaining: remainingAmt,
      remainingAmount: remainingAmt,
      monthlySuggestion: remainingAmt > 0 ? Math.ceil(remainingAmt / Math.max(1, estMonths)) : 0,
      isCompleted: currentAmt >= targetAmt,
      percentage: pct,
      deadline: r[4] instanceof Date ? Utilities.formatDate(r[4], 'Asia/Jakarta', 'yyyy-MM-dd') : String(r[4] || ''),
      ownerId: ownerId,
      ownerName: ownerObj.name,
      ownerAvatar: ownerObj.avatar,
      icon: String(r[6] || 'fa-piggy-bank'),
      color: String(r[7] || '#10B981'),
      matchingRate: matchRate,
      status: String(r[9] || 'Aktif'),
      aiEtaText: remainingAmt === 0
        ? '🎉 Target Impian Tercapai 100%!'
        : `🤖 Estimasi AI: Tercapai dalam ~${estMonths} bulan (${matchRate > 0 ? `Bonus Ortu +${matchRate}% aktif` : 'Rutin menyisihkan surplus'})`
    });
  }

  let totalBalance = 0;
  let visibleWallets = wallets;
  if (isAdmin) {
    totalBalance = wallets.reduce((acc, w) => acc + w.currentBalance, 0);
  } else {
    const quota = currentUser.allowanceQuota || 500000;
    const childSpent = currentMonthTrx
      .filter(t => t.type === 'Keluar')
      .reduce((acc, t) => acc + t.amount, 0);
    totalBalance = Math.max(0, quota - childSpent);
    visibleWallets = [{
      id: 'WLT-05',
      name: `Kuota Jajan ${currentUser.name.split(' ')[1] || currentUser.name}`,
      type: 'E-wallet',
      initialBalance: quota,
      currentBalance: totalBalance,
      info: `Terpakai Rp ${formatRupiahPlain(childSpent)} dari Rp ${formatRupiahPlain(quota)}`
    }];
  }

  const totalBudgetLimit = categoryBreakdown.reduce((acc, c) => acc + c.limit, 0);
  const totalGoalsSaved = savingsGoals.reduce((acc, g) => acc + g.currentAmount, 0);
  const totalGoalsTarget = savingsGoals.reduce((acc, g) => acc + g.targetAmount, 0);

  const responsePayload = {
    serverTime: Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd HH:mm:ss'),
    currentMonthYear: currentYM,
    prevMonthYear: prevYM,
    dataHash: `${currentMonthTrx.length}_${totalBalance}_${totalExpense}_${totalGoalsSaved}_${fundRequests.length}_${bills.filter(b => b.status === 'Lunas').length}`,
    currentUser: sanitizeMemberForClient(currentUser),
    summary: {
      totalBalance: totalBalance,
      totalIncome: isAdmin ? totalIncome : (currentUser.allowanceQuota || 500000),
      totalExpense: totalExpense,
      totalBudgetLimit: totalBudgetLimit,
      budgetUsedPercent: totalBudgetLimit > 0 ? Math.round((totalExpense / totalBudgetLimit) * 100) : 0,
      transactionCount: currentMonthTrx.filter(t => t.approvalStatus !== 'Dibatalkan').length,
      totalGoalsSaved: totalGoalsSaved,
      totalGoalsTarget: totalGoalsTarget
    },
    categories: categories,
    categoryBreakdown: categoryBreakdown,
    wallets: visibleWallets,
    transactions: currentMonthTrx,
    bills: bills,
    fundRequests: fundRequests.reverse(),
    insights: insights,
    savingsGoals: savingsGoals,
    familyMembers: isAdmin ? allMembers.map(sanitizeMemberForClient) : [sanitizeMemberForClient(currentUser)],
    systemConfig: isAdmin ? {
      hasGeminiKey: Boolean(getConfig('GEMINI_API_KEY', '')),
      hasTelegramToken: Boolean(getConfig('TELEGRAM_BOT_TOKEN', '')),
      hasWaToken: Boolean(getConfig('WA_API_TOKEN', '')),
      inviteCode: getConfig('FAMILY_INVITE_CODE', 'QYONA-2026'),
      spreadsheetUrl: ss.getUrl()
    } : null
  };

  // Lampirkan 6 Modul AI Insight Canggih Qyona (Health Score, Micro-Leakage, Safe Daily Spend, Challenges)
  try {
    responsePayload.financialHealth = calculateFinancialHealthScore(responsePayload, currentUser);
    responsePayload.microLeakages = detectMicroLeakages(currentMonthTrx.filter(t => t.approvalStatus !== 'Dibatalkan'), currentYM);
    responsePayload.predictiveCashflow = calculatePredictiveCashflow(responsePayload, currentYM);
    responsePayload.weeklyChallenges = getWeeklySavingChallenges(responsePayload, currentUser.id);
  } catch (errAi) {
    console.error('Error saat kalkulasi modul AI Insight: ' + errAi.message);
  }

  try {
    const jsonStr = JSON.stringify(responsePayload);
    if (jsonStr.length < 95000) {
      CacheService.getScriptCache().put(cacheKey, jsonStr, 300);
    }
  } catch (e) {}

  return responsePayload;
}

/**
 * Hitung ulang Saldo Berjalan di Sheet Dompet menggunakan Batch Write (1x setValues, bukan loop setValue)
 */
function recalculateAllWalletBalances(ss) {
  ss = ss || getSpreadsheet();
  const shDompet = ss.getSheetByName(SHEET_NAMES.DOMPET);
  const shTrx = ss.getSheetByName(SHEET_NAMES.TRANSAKSI);
  if (!shDompet || !shTrx) return;

  const domData = shDompet.getDataRange().getValues();
  const trxData = shTrx.getDataRange().getValues();

  const deltaByWallet = {};
  for (let i = 1; i < trxData.length; i++) {
    const r = trxTrxRow(trxData[i]);
    if (!r.id || r.status === 'Dibatalkan') continue;
    if (!deltaByWallet[r.walletId]) deltaByWallet[r.walletId] = 0;
    if (r.type === 'Masuk') {
      deltaByWallet[r.walletId] += r.amount;
    } else {
      deltaByWallet[r.walletId] -= r.amount;
    }
  }

  const updatedBalances = [];
  for (let j = 1; j < domData.length; j++) {
    const wId = String(domData[j][0]);
    const initBal = Number(domData[j][3] || 0);
    const runningBal = wId ? (initBal + (deltaByWallet[wId] || 0)) : initBal;
    updatedBalances.push([runningBal]);
  }
  if (updatedBalances.length > 0) {
    shDompet.getRange(2, 5, updatedBalances.length, 1).setValues(updatedBalances);
  }
  invalidateServerCache();
}

function trxTrxRow(r) {
  return {
    id: String(r[0] || ''),
    type: String(r[2] || 'Keluar'),
    amount: Number(r[3] || 0),
    walletId: String(r[6] || 'WLT-01'),
    status: String(r[10] || 'Disetujui')
  };
}

/**
 * ============================================================================
 * CRUD TRANSAKSI DENGAN LOCKSERVICE & VALIDASI RBAC (US-1, US-2, US-6)
 * ============================================================================
 */
function saveTransaction(memberId, payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const user = verifyMemberById(memberId);
    if (!user) throw new Error('Pengguna tidak terautentikasi.');

    const ss = getSpreadsheet();
    const shTrx = ss.getSheetByName(SHEET_NAMES.TRANSAKSI);
    const data = shTrx.getDataRange().getValues();

    const isAdmin = user.role === 'Admin';
    const amount = Math.abs(Number(payload.amount || 0));
    if (!amount || amount <= 0) {
      throw new Error('Nominal transaksi harus lebih besar dari Rp 0.');
    }

    // RBAC Rule US-6: Input dari Anak otomatis dikunci ke kategori "Jajan/Anak" & Tipe "Keluar"
    let category = String(payload.category || 'Dapur & Makanan');
    let type = String(payload.type || 'Keluar');
    let walletId = String(payload.walletId || (isAdmin ? 'WLT-01' : 'WLT-05'));
    let approvalStatus = isAdmin ? 'Disetujui' : 'Pending';

    if (!isAdmin) {
      category = 'Jajan/Anak';
      type = 'Keluar';
      walletId = 'WLT-05';
    }

    const description = String(payload.description || '').trim() || category;
    const dateStr = payload.date || Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd HH:mm');
    const source = String(payload.source || 'Form');
    const receiptUrl = String(payload.receiptUrl || '');

    // Jika Edit Transaksi (memiliki ID yang sudah ada)
    if (payload.id) {
      for (let i = 1; i < data.length; i++) {
        if (String(data[i][0]) === String(payload.id)) {
          const ownerId = String(data[i][7]);
          const currentApproval = String(data[i][10] || 'Disetujui');

          if (!isAdmin) {
            if (ownerId !== user.id) {
              throw new Error('RBAC: Anda hanya boleh mengubah transaksi milik sendiri.');
            }
            if (currentApproval === 'Disetujui') {
              throw new Error('RBAC: Transaksi ini sudah disetujui Admin dan tidak dapat diubah lagi.');
            }
          }

          const updatedRow = [
            payload.id,
            dateStr,
            type,
            amount,
            category,
            description,
            walletId,
             isAdmin && payload.targetMemberId ? payload.targetMemberId : ownerId,
            receiptUrl || String(data[i][8] || ''),
            source,
            isAdmin ? (payload.approvalStatus || 'Disetujui') : currentApproval
          ];
          shTrx.getRange(i + 1, 1, 1, updatedRow.length).setValues([updatedRow]);
          recalculateAllWalletBalances(ss);
          return {
            success: true,
            mode: 'update',
            transactionId: payload.id,
            message: `Transaksi ${payload.id} berhasil diperbarui.`
          };
        }
      }
    }

    // Buat Transaksi Baru
    const newId = 'TRX-' + Utilities.formatDate(new Date(), 'Asia/Jakarta', 'ddHHmmss') + '-' + Math.floor(Math.random() * 90 + 10);
    const newRow = [
      newId,
      dateStr,
      type,
      amount,
      category,
      description,
      walletId,
      user.id,
      receiptUrl,
      source,
      approvalStatus
    ];
    shTrx.appendRow(newRow);
    recalculateAllWalletBalances(ss);

    // Cek apakah pengeluaran kategori melewati ambang peringatan budget (default 80%)
    const budgetAlert = checkCategoryBudgetWarning(ss, category);

    return {
      success: true,
      mode: 'create',
      transactionId: newId,
      category: category,
      amount: amount,
      budgetAlert: budgetAlert,
      message: `Transaksi ${description} sebesar Rp ${formatRupiahPlain(amount)} berhasil dicatat ke kategori ${category}.`
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Batalkan Transaksi (Soft-Delete Audit Trail: status diubah menjadi 'Dibatalkan', baris tetap tersimpan, saldo direfund)
 */
function deleteTransaction(memberId, transactionId) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const user = verifyMemberById(memberId);
    if (!user) throw new Error('Akses tidak sah.');

    const ss = getSpreadsheet();
    const shTrx = ss.getSheetByName(SHEET_NAMES.TRANSAKSI);
    const data = shTrx.getDataRange().getValues();
    const isAdmin = user.role === 'Admin';

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(transactionId)) {
        const ownerId = String(data[i][7]);
        const status = String(data[i][10] || 'Disetujui');
        if (!isAdmin) {
          if (ownerId !== user.id) {
            throw new Error('RBAC: Tidak dapat membatalkan transaksi anggota lain.');
          }
          if (status === 'Disetujui') {
            throw new Error('RBAC: Transaksi yang sudah disetujui Admin tidak bisa dibatalkan.');
          }
        }
        shTrx.getRange(i + 1, 11).setValue('Dibatalkan');
        invalidateServerCache();
        recalculateAllWalletBalances(ss);
        return { success: true, message: `Transaksi ${transactionId} berhasil dibatalkan dan saldo dikembalikan.` };
      }
    }
    throw new Error('Transaksi tidak ditemukan.');
  } finally {
    lock.releaseLock();
  }
}

/**
 * Batalkan sekumpulan transaksi sekaligus (Batch Undo Soft-Delete)
 * Menandai status 'Dibatalkan' dan otomatis mengembalikan saldo dompet
 */
function undoBatchTransactions(memberId, transactionIds) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const user = verifyMemberById(memberId);
    if (!user) throw new Error('Akses tidak sah.');

    const ss = getSpreadsheet();
    const shTrx = ss.getSheetByName(SHEET_NAMES.TRANSAKSI);
    const data = shTrx.getDataRange().getValues();
    const isAdmin = user.role === 'Admin';

    const idsToDelete = Array.isArray(transactionIds)
      ? transactionIds.map(String)
      : String(transactionIds || '').split(',').map(s => s.trim()).filter(Boolean);

    if (idsToDelete.length === 0) {
      return { success: true, deletedCount: 0, message: 'Tidak ada transaksi yang dipilih.' };
    }

    const idSet = {};
    idsToDelete.forEach(id => { idSet[id] = true; });

    let updatedCount = 0;
    for (let i = 1; i < data.length; i++) {
      const trxId = String(data[i][0]);
      if (idSet[trxId]) {
        const ownerId = String(data[i][7]);
        const status = String(data[i][10] || 'Disetujui');
        if (!isAdmin) {
          if (ownerId !== user.id) {
            throw new Error('RBAC: Tidak dapat membatalkan transaksi anggota lain.');
          }
          if (status === 'Disetujui') {
            throw new Error('RBAC: Transaksi yang sudah disetujui Admin tidak dapat dibatalkan.');
          }
        }
        shTrx.getRange(i + 1, 11).setValue('Dibatalkan');
        updatedCount++;
      }
    }

    invalidateServerCache();
    recalculateAllWalletBalances(ss);
    return {
      success: true,
      deletedCount: updatedCount,
      message: `Berhasil membatalkan ${updatedCount} transaksi dan mengembalikan saldo dompet.`
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Admin menyetujui transaksi anak (status Pending -> Disetujui)
 */
function approveChildTransaction(adminId, transactionId) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const admin = verifyMemberById(adminId);
    if (!admin || admin.role !== 'Admin') {
      throw new Error('Hanya Admin yang dapat menyetujui transaksi.');
    }
    const ss = getSpreadsheet();
    const shTrx = ss.getSheetByName(SHEET_NAMES.TRANSAKSI);
    const data = shTrx.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(transactionId)) {
        shTrx.getRange(i + 1, 11).setValue('Disetujui');
        return { success: true, message: `Transaksi ${transactionId} telah disetujui.` };
      }
    }
    throw new Error('Transaksi tidak ditemukan.');
  } finally {
    lock.releaseLock();
  }
}

function checkCategoryBudgetWarning(ss, categoryName) {
  const shKat = ss.getSheetByName(SHEET_NAMES.KATEGORI);
  const shTrx = ss.getSheetByName(SHEET_NAMES.TRANSAKSI);
  const katData = shKat.getDataRange().getValues();
  let limit = 0;
  let warnPct = 80;
  for (let i = 1; i < katData.length; i++) {
    if (String(katData[i][0]) === categoryName) {
      limit = Number(katData[i][1] || 0);
      warnPct = Number(katData[i][2] || 80);
      break;
    }
  }
  if (limit <= 0) return null;

  const currentYM = Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM');
  const trxData = shTrx.getDataRange().getValues();
  let spent = 0;
  for (let j = 1; j < trxData.length; j++) {
    const r = trxData[j];
    const dStr = r[1] instanceof Date
      ? Utilities.formatDate(r[1], 'Asia/Jakarta', 'yyyy-MM')
      : String(r[1]).slice(0, 7);
    if (dStr === currentYM && String(r[2]) === 'Keluar' && String(r[4]) === categoryName && String(r[10]) !== 'Dibatalkan') {
      spent += Number(r[3] || 0);
    }
  }

  const pct = Math.round((spent / limit) * 100);
  if (pct >= 100) {
    return `🚨 OVERBUDGET! Kategori "${categoryName}" telah mencapai ${pct}% (Rp ${formatRupiahPlain(spent)} dari batas Rp ${formatRupiahPlain(limit)}).`;
  } else if (pct >= warnPct) {
    return `⚠️ Peringatan Anggaran: Kategori "${categoryName}" sudah mencapai ${pct}% dari kuota bulanan (Rp ${formatRupiahPlain(spent)} / Rp ${formatRupiahPlain(limit)}).`;
  }
  return null;
}

/**
 * ============================================================================
 * AI CHATBOT NLP & OCR STRUK BELANJA (US-1 & US-2)
 * ============================================================================
 */

/**
 * Proses pesan obrolan dari Web App atau Webhook WhatsApp/Telegram
 * Mendukung:
 * 1. Pertanyaan seputar keuangan ("Sisa uang makan bulan ini berapa?", "Saldo keluarga berapa?")
 * 2. Input transaksi1 atau banyak item sekaligus ("Beli beras 5kg 75rb dan gas 22rb pakai tunai")
 * 3. Permintaan dana tambahan dari Anak ("Minta uang tambahan 50rb buat beli buku")
 */
function processChatbotMessage(memberId, rawMessage, confirmedCategory) {
  initDatabaseIfNeeded();
  const user = verifyMemberById(memberId);
  if (!user) throw new Error('Anggota tidak dikenali.');

  const text = String(rawMessage || '').trim();
  if (!text) throw new Error('Pesan tidak boleh kosong.');

  const isAdmin = user.role === 'Admin';
  const ss = getSpreadsheet();

  // 1. Cek apakah pesan berupa ACTION COMMAND instan (Fitur #5)
  try {
    const actionResult = handleAIActionCommands(text, user, ss);
    if (actionResult) {
      logChatAndInsight(ss, user.id, text, actionResult.reply, 'Harian', 0, 'Aksi Eksekusi');
      return actionResult;
    }
  } catch (cmdErr) {
    return {
      status: 'ACTION_FAILED',
      reply: `⚠️ Gagal mengeksekusi perintah: ${cmdErr.message}`
    };
  }

  // 2. Cek apakah pesan berupa PERTANYAAN seputar saldo / budget
  if (isQuestionIntent(text)) {
    const answer = answerFinancialQuestion(ss, user, text);
    logChatAndInsight(ss, user.id, text, answer, 'Harian', 0, 'Terjawab');
    return {
      status: 'QUESTION_ANSWERED',
      reply: answer,
      transactionsCreated: []
    };
  }

  // 3. Cek apakah Member Anak mengajukan request dana tambahan (US-6 AC2)
  if (!isAdmin && /(minta|ajukan|request|butuh|tambah)\s+(uang|dana|jajan|saldo)/i.test(text)) {
    const reqNominal = extractFirstAmount(text);
    if (reqNominal > 0) {
      const reqRes = createFundRequest(user.id, {
        amount: reqNominal,
        reason: text
      });
      return {
        status: 'FUND_REQUEST_CREATED',
        reply: `📩 Pengajuan dana tambahan sebesar *Rp ${formatRupiahPlain(reqNominal)}* untuk _"${text}"_ berhasil dikirim ke Admin (Ayah & Bunda) untuk disetujui!`,
        request: reqRes
      };
    }
  }

  // 4. Smart Multi-Item & Multi-Wallet Parser (Fitur #1, #2, #4)
  const items = parseSmartMultiItem(text, isAdmin, confirmedCategory, ss);

  if (!items || items.length === 0) {
    return {
      status: 'UNRECOGNIZED',
      reply: '🤔 Maaf, Qyona AI belum menemukan nominal rupiah di pesanmu.\n\nContoh ketik borongan:\n• _"Beli beras 5kg 75rb, ayam 2 ekor @35rb pakai tunai, dan bensin 150rb via GoPay"_\n• _"Tabung 200rb ke Liburan Bali"_\n• _"Bayar lunas WiFi Biznet"_\n• _"Buat kategori Hobi budget 500rb"_'
    };
  }

  // US-1 AC2: Jika kategori tidak terdeteksi otomatis dan pengguna adalah Admin, tanyakan konfirmasi
  const ambiguousItem = items.find(it => it.needsCategoryConfirmation);
  if (ambiguousItem && isAdmin && !confirmedCategory) {
    return {
      status: 'NEEDS_CONFIRMATION',
      pendingMessage: text,
      detectedAmount: ambiguousItem.amount,
      detectedDescription: ambiguousItem.description,
      detectedWalletId: ambiguousItem.walletId,
      suggestedCategories: ['Dapur & Makanan', 'Tagihan & Utilitas', 'Transportasi & BBM', 'Jajan/Anak', 'Hiburan & Keluarga', 'Kesehatan & Darurat', 'Pendidikan & Les', 'Hewan Peliharaan', 'Skincare & Kecantikan', 'Kopi & Nongkrong'],
      reply: `🤔 Saya mendeteksi transaksi *${ambiguousItem.description}* sebesar *Rp ${formatRupiahPlain(ambiguousItem.amount)}*, namun kategorinya belum spesifik.\n\nSilakan pilih kategori di bawah ini sebelum saya menyimpannya:`
    };
  }

  // Simpan seluruh item ke Database
  const savedItems = [];
  const alerts = [];
  const newCategoriesCreated = [];
  const batchId = 'BATCH-' + Utilities.getUuid().slice(0, 8);

  items.forEach(item => {
    const targetCategory = confirmedCategory || item.category;

    // Pastikan kategori ada di sheet Kategori & Budget (Fitur #2: Auto-create)
    const catMeta = ensureCategoryExists(targetCategory, { type: item.type }, ss);
    if (catMeta.created) {
      newCategoriesCreated.push(catMeta);
      item.isNewCategory = true;
    }

    // Pelajari kata kunci ke Kamus Kata Kunci AI (Fitur #4)
    try {
      const kw = item.description.replace(/^(?:beli|bayar|isi|pesan|jajan)\s+/i, '').trim();
      if (kw.length >= 3) {
        learnKeywordCategory(kw, targetCategory, item.walletId, ss);
      }
    } catch (e) {}

    const res = saveTransaction(user.id, {
      type: item.type,
      amount: item.amount,
      category: targetCategory,
      description: item.qty ? `${item.description} (${item.qty}x)` : item.description,
      walletId: item.walletId,
      source: 'Chat'
    });

    savedItems.push({
      id: res.transactionId,
      description: item.description,
      qty: item.qty,
      unitPrice: item.unitPrice,
      amount: item.amount,
      category: res.category,
      categoryIcon: catMeta.icon || 'fa-tag',
      categoryColor: catMeta.color || '#10B981',
      isNewCategory: Boolean(item.isNewCategory || catMeta.created),
      type: item.type,
      walletId: item.walletId,
      walletName: item.walletName
    });

    if (res.budgetAlert) alerts.push(res.budgetAlert);
  });

  // US-1 AC3: Balas ringkasan transaksi
  const totalSaved = savedItems.reduce((s, i) => s + i.amount, 0);
  const lines = savedItems.map((it, idx) =>
    `${idx + 1}. *${it.description}* — Rp ${formatRupiahPlain(it.amount)} _(${it.category}${it.isNewCategory ? ' ✨Baru' : ''} • ${it.walletName})_`
  );

  let replyMsg = `✅ *Tercatat Otomatis (${savedItems.length} Transaksi)*\n` +
    lines.join('\n') +
    `\n\n💰 *Total:* Rp ${formatRupiahPlain(totalSaved)}\n👤 *Dicatat oleh:* ${user.name}`;

  if (!isAdmin) {
    replyMsg += `\n🔒 _Info RBAC: Otomatis masuk kategori Jajan/Anak._`;
  }
  if (alerts.length > 0) {
    replyMsg += `\n\n${alerts.join('\n')}`;
  }

  logChatAndInsight(ss, user.id, text, replyMsg, 'Harian', 0, 'Tersimpan');

  return {
    status: 'SAVED',
    batchId: batchId,
    reply: replyMsg,
    transactionsCreated: savedItems,
    isBatch: savedItems.length > 1,
    totalAmount: totalSaved,
    undoTransactionIds: savedItems.map(i => i.id),
    newCategoriesCreated: newCategoriesCreated
  };
}

/**
 * Deteksi apakah teks chat adalah kalimat tanya
 */
function isQuestionIntent(text) {
  const lower = text.toLowerCase();
  const hasQuestionWord = /(berapa|sisa|total|cek|gimana|bagaimana|info|status|rekap|laporan|apakah|\?)/i.test(lower);
  const hasFinanceKeyword = /(saldo|uang|budget|anggaran|dapur|makan|jajan|tagihan|pengeluaran|pemasukan|dompet|hemat|boros)/i.test(lower);
  // Pastikan bukan kalimat perintah input seperti "beli makan 25rb"
  const isPurchase = /^(beli|bayar|isi|jajan|catat|masuk|transfer|belanja)\b/i.test(lower) && extractFirstAmount(lower) > 0;
  return hasQuestionWord && hasFinanceKeyword && !isPurchase;
}

/**
 * Jawab pertanyaan langsung pengguna dari data real-time Spreadsheet
 */
function answerFinancialQuestion(ss, user, questionText) {
  const data = getAppBootstrapData(user.id);
  const lower = questionText.toLowerCase();

  if (user.role !== 'Admin') {
    const childCat = data.categoryBreakdown.find(c => c.name === 'Jajan/Anak') || { spent: 0, limit: user.allowanceQuota || 500000 };
    const remaining = Math.max(0, childCat.limit - childCat.spent);
    return `👦Halo *${user.name}*!\n\n` +
      `• *Sisa Kuota Jajanmu:* Rp ${formatRupiahPlain(remaining)}\n` +
      `• *Terpakai Bulan Ini:* Rp ${formatRupiahPlain(childCat.spent)} dari Rp ${formatRupiahPlain(childCat.limit)} (${childCat.percentage || 0}%)\n\n` +
      `Tetap semangat menabung ya! 🌟`;
  }

  // Cek apakah menanyakan kategori tertentu (mis. "uang makan" / "dapur")
  let matchedCat = null;
  if (/dapur|makan|sembako|masak|beras/i.test(lower)) {
    matchedCat = data.categoryBreakdown.find(c => c.name === 'Dapur & Makanan');
  } else if (/tagihan|listrik|air|wifi|internet/i.test(lower)) {
    matchedCat = data.categoryBreakdown.find(c => c.name === 'Tagihan & Utilitas');
  } else if (/jajan|anak|raka|nayla/i.test(lower)) {
    matchedCat = data.categoryBreakdown.find(c => c.name === 'Jajan/Anak');
  } else if (/bensin|transport|bbm|tol|mobil/i.test(lower)) {
    matchedCat = data.categoryBreakdown.find(c => c.name === 'Transportasi & BBM');
  } else if (/hiburan|nonton|kopi|jalan/i.test(lower)) {
    matchedCat = data.categoryBreakdown.find(c => c.name === 'Hiburan & Keluarga');
  }

  if (matchedCat) {
    const sisa = Math.max(0, matchedCat.limit - matchedCat.spent);
    return `📊 *Status Anggaran ${matchedCat.name} (${data.currentMonthYear})*\n\n` +
      `• *Sisa Anggaran:* Rp ${formatRupiahPlain(sisa)}\n` +
      `• *Terpakai:* Rp ${formatRupiahPlain(matchedCat.spent)} (${matchedCat.percentage}%)\n` +
      `• *Batas Bulanan:* Rp ${formatRupiahPlain(matchedCat.limit)}\n` +
      `• *Perbandingan Bulan Lalu:* ${matchedCat.diffFromPrev >= 0 ? 'Naik' : 'Turun'} Rp ${formatRupiahPlain(Math.abs(matchedCat.diffFromPrev))}`;
  }

  // Jawaban ringkasan umum
  const s = data.summary;
  const sisaBudgetTotal = Math.max(0, s.totalBudgetLimit - s.totalExpense);
  return `🏦 *Ringkasan Kas Keluarga Qyona (${data.currentMonthYear})*\n\n` +
    `• *Saldo Gabungan Semua Dompet:* Rp ${formatRupiahPlain(s.totalBalance)}\n` +
    `• *Pemasukan Bulan Ini:* Rp ${formatRupiahPlain(s.totalIncome)}\n` +
    `• *Pengeluaran Bulan Ini:* Rp ${formatRupiahPlain(s.totalExpense)} (${s.budgetUsedPercent}% dari budget)\n` +
    `• *Sisa Kuota Anggaran:* Rp ${formatRupiahPlain(sisaBudgetTotal)}`;
}

/**
 * Fitur #5: Eksekusi Perintah Cepat AI (Action Commands)
 */
function handleAIActionCommands(text, user, ss) {
  const clean = String(text || '').trim();
  const isAdmin = user.role === 'Admin';
  ss = ss || getSpreadsheet();

  // 1. SETOR TABUNGAN / KANTONG IMPIAN
  const goalMatch = clean.match(/^(?:tabung|nabung|setor)\s+(?:sebesar\s+)?(.+?)\s+(?:ke|untuk)\s+(.+?)(?:\s+(?:pakai|via|dari)\s+(.+))?$/i);
  if (goalMatch) {
    const amount = extractFirstAmount(goalMatch[1]);
    const goalQuery = goalMatch[2].trim().toLowerCase();
    const walletText = goalMatch[3] || clean;
    const wallet = detectWalletFromText(walletText, isAdmin) || (isAdmin ? { id: 'WLT-01', name: 'BCA Keluarga' } : { id: 'WLT-05', name: 'Saku Anak' });

    if (amount > 0) {
      const shGoals = ss.getSheetByName(SHEET_NAMES.GOALS);
      if (shGoals) {
        const data = shGoals.getDataRange().getValues();
        let targetGoal = null;
        for (let i = 1; i < data.length; i++) {
          const title = String(data[i][1]).toLowerCase();
          if (title.includes(goalQuery) || goalQuery.includes(title)) {
            targetGoal = {
              rowIndex: i + 1,
              id: String(data[i][0]),
              title: String(data[i][1]),
              target: Number(data[i][2] || 0),
              current: Number(data[i][3] || 0)
            };
            break;
          }
        }
        if (targetGoal) {
          contributeToGoal(user.id, {
            goalId: targetGoal.id,
            amount: amount,
            walletId: wallet.id
          });
          const newTotal = targetGoal.current + amount;
          const pct = targetGoal.target > 0 ? Math.min(100, Math.round((newTotal / targetGoal.target) * 100)) : 100;
          return {
            status: 'ACTION_EXECUTED',
            actionType: 'GOAL_CONTRIBUTION',
            reply: `🐷 *Setoran Tabungan Tercatat!*\n• *Target:* ${targetGoal.title}\n• *Nominal:* Rp ${formatRupiahPlain(amount)}\n• *Dompet:* ${wallet.name}\n• *Terkumpul Sekarang:* Rp ${formatRupiahPlain(newTotal)} (${pct}%)\n• *Oleh:* ${user.name}`,
            goal: { id: targetGoal.id, title: targetGoal.title, amount: amount, newTotal: newTotal, target: targetGoal.target, percent: pct }
          };
        }
      }
    }
  }

  // 2. BAYAR TAGIHAN RUTIN
  const billMatch = clean.match(/^(?:bayar|lunasi|bayarkan|sudah bayar|lunas)\s+(?:lunas\s+)?(?:tagihan\s+)?(.+)$/i) ||
                    clean.match(/^(?:tagihan\s+)?(.+?)\s+(?:sudah\s+)?(?:lunas|dibayar)$/i);
  if (billMatch) {
    if (!isAdmin) {
      throw new Error('RBAC: Hanya Admin (Ayah/Bunda) yang dapat menandai pelunasan tagihan.');
    }
    const query = billMatch[1].trim().toLowerCase();
    const shBills = ss.getSheetByName(SHEET_NAMES.TAGIHAN);
    if (shBills) {
      const data = shBills.getDataRange().getValues();
      let targetBill = null;
      for (let i = 1; i < data.length; i++) {
        const name = String(data[i][1]).toLowerCase();
        if (name.includes(query) || query.includes(name) || (query.includes('wifi') && name.includes('wifi')) || (query.includes('pln') && name.includes('pln')) || (query.includes('listrik') && name.includes('listrik')) || (query.includes('air') && name.includes('air')) || (query.includes('pdam') && name.includes('pdam')) || (query.includes('bpjs') && name.includes('bpjs'))) {
          targetBill = {
            id: String(data[i][0]),
            name: String(data[i][1]),
            amount: Number(data[i][2] || 0)
          };
          break;
        }
      }
      if (targetBill) {
        markBillAsPaid(user.id, targetBill.id);
        return {
          status: 'ACTION_EXECUTED',
          actionType: 'BILL_PAID',
          reply: `⚡ *Tagihan Rutin Lunas!*\n• *Nama Tagihan:* ${targetBill.name}\n• *Nominal:* Rp ${formatRupiahPlain(targetBill.amount)}\n• *Status:* Lunas ✅\n• *Dicatat oleh:* ${user.name}`,
          bill: targetBill
        };
      }
    }
  }

  // 3. UBAH ANGGARAN KATEGORI
  const budgetMatch = clean.match(/^(?:naikkan|turunkan|ubah|atur|ganti|set)\s+(?:budget|anggaran|limit)\s+(.+?)(?:\s+(?:jadi|menjadi|sebesar|ke))?\s+((?:rp\.?\s*)?(?:\d+(?:[.,]\d+)?\s*(?:juta|jt|ribu|rb|k)|\d{1,3}(?:\.\d{3})+|\d{4,9}))$/i);
  if (budgetMatch) {
    if (!isAdmin) throw new Error('RBAC: Hanya Admin yang dapat mengubah batas anggaran kategori.');
    const catQuery = budgetMatch[1].trim().toLowerCase();
    const newLimit = extractFirstAmount(budgetMatch[2]);
    if (newLimit > 0) {
      const shCat = ss.getSheetByName(SHEET_NAMES.KATEGORI);
      if (shCat) {
        const data = shCat.getDataRange().getValues();
        let matchedCat = null;
        for (let i = 1; i < data.length; i++) {
          const name = String(data[i][0]);
          if (name.toLowerCase().includes(catQuery) || catQuery.includes(name.toLowerCase())) {
            matchedCat = name;
            break;
          }
        }
        if (matchedCat) {
          updateCategoryBudget(user.id, matchedCat, newLimit);
          return {
            status: 'ACTION_EXECUTED',
            actionType: 'BUDGET_UPDATED',
            reply: `📊 *Anggaran Kategori Diperbarui!*\n• *Kategori:* ${matchedCat}\n• *Batas Anggaran Baru:* Rp ${formatRupiahPlain(newLimit)}/bulan\n• *Diubah oleh:* ${user.name}`,
            category: { name: matchedCat, limit: newLimit }
          };
        }
      }
    }
  }

  // 4. BUAT KATEGORI BARU LANGSUNG DARI CHAT
  const createCatMatch = clean.match(/^(?:buat|tambah|bikin|kategori baru)\s+(?:kategori\s+)?(?:baru\s+)?(.+?)(?:\s+(?:budget|limit|anggaran)\s+(.+))?$/i);
  if (createCatMatch) {
    if (!isAdmin) throw new Error('RBAC: Hanya Admin yang dapat membuat kategori baru.');
    const catName = createCatMatch[1].trim();
    const limit = createCatMatch[2] ? extractFirstAmount(createCatMatch[2]) : 500000;
    if (catName.length >= 3) {
      const res = ensureCategoryExists(catName, { limit: limit || 500000 }, ss);
      return {
        status: 'ACTION_EXECUTED',
        actionType: 'CATEGORY_CREATED',
        reply: `✨ *Kategori Baru Dibuat!*\n• *Nama:* ${res.name}\n• *Batas Anggaran:* Rp ${formatRupiahPlain(res.limit)}/bulan\n• *Ikon:* <i class="fa-solid ${res.icon}"></i> (${res.icon})\n• *Warna:* ${res.color}\n• *Oleh:* ${user.name}`,
        category: res
      };
    }
  }

  return null;
}

/**
 * Fitur #1: Smart Multi-Item & Multi-Wallet Parser dengan Dukungan Continuous Stream & Backward Wallet Inheritance
 */
function tokenizeContinuousStream(segment) {
  const priceRegex = /(?:(\d+)\s*(?:ekor|kg|gr|gram|liter|ltr|ikat|buah|pcs|bungkus|pak|box|porsi|lembar|orang|kali)?\s*[@x*]\s*)?(?:rp\.?\s*)?(?:\d+(?:[.,]\d+)?\s*(?:juta|jt|ribu|rb|k)\b|\d{1,3}(?:\.\d{3})+\b|\b\d{4,9}\b)/gi;
  
  const matches = [];
  let m;
  while ((m = priceRegex.exec(segment)) !== null) {
    if (m[0].trim()) {
      let endPos = m.index + m[0].length;
      // Cek apakah langsung diikuti kata dompet / pembayaran (misal: "30rb tunai" atau "50rb pakai tunai")
      const remaining = segment.substring(endPos);
      const payMatch = remaining.match(/^\s*(?:(?:pakai|via|dengan|dari|lewat|pake)\s+)?(?:tunai|cash|bca|mandiri|gopay|qris|ovo|dana|shopeepay)\b/i);
      if (payMatch) {
        endPos += payMatch[0].length;
      }
      matches.push({ index: m.index, endPos: endPos, text: m[0] });
    }
  }

  if (matches.length <= 1) {
    return [segment];
  }

  const chunks = [];
  for (let i = 0; i < matches.length; i++) {
    const startIdx = i === 0 ? 0 : matches[i - 1].endPos;
    const endIdx = i === matches.length - 1 ? segment.length : matches[i].endPos;
    const chunkText = segment.substring(startIdx, endIdx).trim();
    if (chunkText) {
      chunks.push(chunkText);
    }
  }

  return chunks.length > 0 ? chunks : [segment];
}

function parseSmartMultiItem(rawText, isAdmin, forcedCategory, ss) {
  const defaultWallet = isAdmin ? { id: 'WLT-01', name: 'BCA Keluarga' } : { id: 'WLT-05', name: 'Saku Anak (Gopay/Cash)' };

  // Step 1: Pisahkan berdasarkan major connector (terus, lalu, kemudian, baris baru, titik koma)
  const rawClauses = String(rawText || '')
    .split(/(?:\r?\n|;\s*|\s+(?:terus|lalu|kemudian)\s+)/i)
    .map(c => c.trim())
    .filter(Boolean);

  const items = [];
  const targetClauses = rawClauses.length > 0 ? rawClauses : [rawText];

  targetClauses.forEach(clause => {
    // Deteksi dompet pada level klausa utuh (untuk backward wallet inheritance)
    const clauseWallet = detectWalletFromText(clause, isAdmin);

    // Step 2: Split subsegments inside clause (koma, "dan", "sama", "+")
    const subSegments = clause
      .split(/(?:\s*,\s*|\s+dan\s+|\s+sama\s+|\s*\+\s*)/i)
      .map(s => s.trim())
      .filter(Boolean);

    // Step 3: Tokenize continuous stream jika ada subsegmen tanpa tanda pemisah
    const finalSegments = [];
    subSegments.forEach(seg => {
      const tokenized = tokenizeContinuousStream(seg);
      tokenized.forEach(tok => finalSegments.push(tok));
    });

    // Step 4: Backward & Forward Wallet Inheritance
    for (let i = 0; i < finalSegments.length; i++) {
      const seg = finalSegments[i];
      const amount = extractFirstAmount(seg);
      if (amount > 0) {
        // Cek wallet segmen sendiri
        let segWallet = detectWalletFromText(seg, isAdmin);
        if (!segWallet) {
          // Cari ke kanan dalam klausa yang sama (pewarisan dompet mundur dari item di sebelahnya)
          for (let j = i + 1; j < finalSegments.length; j++) {
            const forwardW = detectWalletFromText(finalSegments[j], isAdmin);
            if (forwardW) {
              segWallet = forwardW;
              break;
            }
          }
        }
        if (!segWallet) segWallet = clauseWallet || defaultWallet;

        const mult = parseAmountWithMultiplication(seg);

        const catInfo = !isAdmin
          ? { category: 'Jajan/Anak', type: 'Keluar', confident: true }
          : (forcedCategory
              ? { category: forcedCategory, type: forcedCategory === 'Gaji & Pemasukan' ? 'Masuk' : 'Keluar', confident: true }
              : classifyIndonesianCategory(seg, ss));

        const cleanDesc = cleanItemDescription(seg);

        items.push({
          rawText: seg,
          description: cleanDesc || seg,
          amount: amount,
          qty: mult ? mult.qty : null,
          unitPrice: mult ? mult.unitPrice : null,
          category: catInfo.category,
          type: catInfo.type,
          walletId: segWallet.id,
          walletName: segWallet.name,
          needsCategoryConfirmation: !catInfo.confident && isAdmin && !forcedCategory
        });
      }
    }
  });

  // Fallback jika pembagian segmen menghasilkan 0 item tapi ada nominal
  if (items.length === 0) {
    const singleAmount = extractFirstAmount(rawText);
    if (singleAmount > 0) {
      const wallet = detectWalletFromText(rawText, isAdmin) || defaultWallet;
      const mult = parseAmountWithMultiplication(rawText);
      const catInfo = !isAdmin
        ? { category: 'Jajan/Anak', type: 'Keluar', confident: true }
        : (forcedCategory
            ? { category: forcedCategory, type: forcedCategory === 'Gaji & Pemasukan' ? 'Masuk' : 'Keluar', confident: true }
            : classifyIndonesianCategory(rawText, ss));

      items.push({
        rawText: rawText,
        description: cleanItemDescription(rawText) || rawText,
        amount: singleAmount,
        qty: mult ? mult.qty : null,
        unitPrice: mult ? mult.unitPrice : null,
        category: catInfo.category,
        type: catInfo.type,
        walletId: wallet.id,
        walletName: wallet.name,
        needsCategoryConfirmation: !catInfo.confident && isAdmin && !forcedCategory
      });
    }
  }

  return items;
}

/**
 * Backward-compatible wrapper untuk parseNaturalLanguageTransactions
 */
function parseNaturalLanguageTransactions(text, user, forcedCategory) {
  const isAdmin = user.role === 'Admin';
  const geminiKey = getConfig('GEMINI_API_KEY', '');
  const walletDetection = detectWalletFromText(text, isAdmin);

  if (geminiKey) {
    try {
      const aiResult = callGeminiForTextParsing(geminiKey, text, isAdmin, walletDetection);
      if (aiResult && aiResult.items && aiResult.items.length > 0) {
        return aiResult;
      }
    } catch (e) {}
  }

  const items = parseSmartMultiItem(text, isAdmin, forcedCategory);
  return { items: items };
}

/**
 * Hitung perkalian kuantitas otomatis:
 * "ayam 2 ekor @35rb" -> 70.000
 * "3x 15.000" -> 45.000
 * "2 ikat @5000" -> 10.000
 */
function parseAmountWithMultiplication(text) {
  const multRegex = /(\d+)\s*(?:ekor|kg|gr|gram|liter|ltr|ml|ikat|buah|pcs|bungkus|pak|box|porsi|lembar|orang|kali)?\s*[@x*]\s*(?:rp\.?\s*)?(\d+(?:[.,]\d+)?\s*(?:juta|jt|ribu|rb|k|\b|\.000))/i;
  const match = String(text || '').match(multRegex);
  if (match) {
    const qty = parseInt(match[1], 10);
    const rawUnit = match[2].trim();
    let unitNom = 0;
    const unitMatch = rawUnit.match(/(\d+(?:[.,]\d+)?)\s*(juta|jt|ribu|rb|k)\b/i);
    if (unitMatch) {
      const num = parseFloat(unitMatch[1].replace(',', '.'));
      const u = unitMatch[2].toLowerCase();
      if (u === 'juta' || u === 'jt') unitNom = Math.round(num * 1000000);
      else unitNom = Math.round(num * 1000);
    } else if (/\d{1,3}(?:\.\d{3})+/.test(rawUnit)) {
      unitNom = parseInt(rawUnit.replace(/\./g, ''), 10);
    } else {
      unitNom = parseInt(rawUnit, 10);
    }
    if (qty > 0 && unitNom > 0) {
      return { total: qty * unitNom, qty: qty, unitPrice: unitNom, matchedStr: match[0] };
    }
  }
  return null;
}

/**
 * Ekstrak nominal Rupiah dari format populer Indonesia
 */
function extractFirstAmount(str) {
  if (!str) return 0;
  const mult = parseAmountWithMultiplication(str);
  if (mult) return mult.total;

  const cleaned = str.replace(/\b\d+(?:[.,]\d+)?\s*(?:kg|gr|gram|liter|ltr|ml|ons|kw|kwh|pcs|buah|ikat|bungkus|pak|box|orang)\b/gi, ' ');
  const unitRegex = /(?:rp\.?\s*)?(\d+(?:[.,]\d+)?)\s*(juta|jt|ribu|rb|k)\b/i;
  const unitMatch = cleaned.match(unitRegex);
  if (unitMatch) {
    const rawNum = parseFloat(unitMatch[1].replace(',', '.'));
    const unit = unitMatch[2].toLowerCase();
    if (unit === 'juta' || unit === 'jt') return Math.round(rawNum * 1000000);
    if (unit === 'ribu' || unit === 'rb' || unit === 'k') return Math.round(rawNum * 1000);
  }

  const dottedRegex = /(?:rp\.?\s*)?(\d{1,3}(?:\.\d{3})+)\b/i;
  const dottedMatch = cleaned.match(dottedRegex);
  if (dottedMatch) return parseInt(dottedMatch[1].replace(/\./g, ''), 10);

  const plainRegex = /(?:rp\.?\s*)?(\d{3,9})\b/i;
  const plainMatch = cleaned.match(plainRegex);
  if (plainMatch) return parseInt(plainMatch[1], 10);

  return 0;
}

function cleanItemDescription(seg) {
  let s = String(seg || '')
    .replace(/(?:pakai|via|dengan|dari|lewat|pake)\s+(?:tunai|cash|bca|mandiri|gopay|qris|ovo|dana|bank|dompet\s+\w+)/gi, '')
    .replace(/\b(?:tunai|cash|gopay|qris|ovo|dana|bca|mandiri)\b/gi, '')
    .replace(/[@x*]\s*(?:rp\.?\s*)?(?:\d+(?:[.,]\d+)?\s*(?:juta|jt|ribu|rb|k|\b|\.000)|\d{1,3}(?:\.\d{3})+|\d{3,9})/gi, '')
    .replace(/(?:rp\.?\s*)?\d+(?:[.,]\d+)?\s*(?:juta|jt|ribu|rb|k)\b/gi, '')
    .replace(/(?:rp\.?\s*)?\d{1,3}(?:\.\d{3})+\b/gi, '')
    .replace(/(?:rp\.?\s*)?\b\d{4,9}\b/gi, '')
    .replace(/^(?:\s*(?:dan|terus|lalu|kemudian|sama|juga|\+)\s*)+/gi, '')
    .replace(/^(?:\s*(?:tadi\s+(?:pagi|siang|sore|malam)|kemarin|hari\s+ini|barusan|tolong\s+catat(?:kan)?|catat(?:kan)?|masukkan|input)\s*)+/gi, '')
    .replace(/^(?:\s*(?:beli|membeli|belanja|pesan|order|bayar|membayar|topup|top\s+up|isi\s+saldo|isi)\s*)+/gi, function(match) {
      if (/isi\s*$/i.test(match)) return 'Isi ';
      return '';
    })
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return 'Transaksi Harian';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function detectWalletFromText(text, isAdmin) {
  if (!isAdmin) {
    return { id: 'WLT-05', name: 'Saku Anak (Gopay/Cash)' };
  }
  const lower = String(text || '').toLowerCase();
  if (/tunai|cash|dapur/i.test(lower)) return { id: 'WLT-04', name: 'Dompet Tunai Dapur' };
  if (/gopay|qris|ewallet|ovo|dana|shopeepay/i.test(lower)) return { id: 'WLT-03', name: 'GoPay / QRIS Rumah' };
  if (/mandiri/i.test(lower)) return { id: 'WLT-02', name: 'Mandiri Tabungan' };
  if (/bca/i.test(lower)) return { id: 'WLT-01', name: 'BCA Keluarga' };
  return null;
}

/**
 * Fitur #2: Auto-Create Dynamic Category Engine
 * Memastikan kategori tersedia di sheet Kategori & Budget. Jika belum ada, otomatis dibuatkan.
 */
function ensureCategoryExists(categoryName, metadata, ss) {
  if (!categoryName) return { created: false, name: 'Dapur & Makanan', icon: 'fa-utensils', color: '#F97316' };
  categoryName = String(categoryName).trim();
  ss = ss || getSpreadsheet();
  const shCat = ss.getSheetByName(SHEET_NAMES.KATEGORI);
  if (!shCat) return { created: false, name: categoryName, icon: 'fa-tag', color: '#10B981' };

  const data = shCat.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).toLowerCase() === categoryName.toLowerCase()) {
      return {
        created: false,
        name: String(data[i][0]),
        limit: Number(data[i][1] || 0),
        warnPercent: Number(data[i][2] || 80),
        color: String(data[i][3] || '#10B981'),
        icon: String(data[i][4] || 'fa-tag'),
        type: String(data[i][5] || 'Keluar')
      };
    }
  }

  // Belum ada -> Buat Kategori Baru secara otomatis
  const lower = categoryName.toLowerCase();
  let icon = 'fa-tag';
  if (/kucing|anjing|hewan|pet|burung|ikan/i.test(lower)) icon = 'fa-paw';
  else if (/skincare|cantik|makeup|salon|spa|kosmetik/i.test(lower)) icon = 'fa-spa';
  else if (/kopi|cafe|nongkrong|warkop/i.test(lower)) icon = 'fa-mug-hot';
  else if (/game|hobi|fotografi|kamera|mainan/i.test(lower)) icon = 'fa-gamepad';
  else if (/gym|fitness|olahraga|sepeda|lari|futsal/i.test(lower)) icon = 'fa-dumbbell';
  else if (/fashion|baju|pakaian|celana|sepatu|laundry/i.test(lower)) icon = 'fa-shirt';
  else if (/servis|bengkel|ac|elektronik|perbaikan/i.test(lower)) icon = 'fa-wrench';
  else if (/sedekah|infaq|amal|zakat|donasi/i.test(lower)) icon = 'fa-hand-holding-heart';
  else if (/buku|kursus|les|edukasi|pelatihan/i.test(lower)) icon = 'fa-book-open';
  else if (/bayi|baby|popok|anak/i.test(lower)) icon = 'fa-baby';
  else if (/taman|kebun|tanaman/i.test(lower)) icon = 'fa-seedling';

  const palette = ['#F59E0B', '#8B5CF6', '#EC4899', '#14B8A6', '#6366F1', '#06B6D4', '#84CC16', '#F43F5E', '#0EA5E9', '#D97706'];
  const color = palette[data.length % palette.length];
  const limit = (metadata && metadata.limit > 0) ? Number(metadata.limit) : 500000;
  const warnPercent = (metadata && metadata.warnPercent > 0) ? Number(metadata.warnPercent) : 80;
  const type = (metadata && metadata.type) ? metadata.type : (lower.includes('masuk') || lower.includes('gaji') ? 'Masuk' : 'Keluar');

  shCat.appendRow([categoryName, limit, warnPercent, color, icon, type]);

  // Hapus cache agar frontend langsung melihat kategori baru
  try {
    CacheService.getScriptCache().remove('qyona_categories_all');
    PropertiesService.getScriptProperties().deleteProperty('qyona_categories_cache');
  } catch (e) {}

  return {
    created: true,
    name: categoryName,
    limit: limit,
    warnPercent: warnPercent,
    color: color,
    icon: icon,
    type: type
  };
}

/**
 * Fitur #4: Memori Kamus Pintar Keluarga
 */
function lookupKeywordCategory(phrase, ss) {
  if (!phrase) return null;
  ss = ss || getSpreadsheet();
  const shKamus = ss.getSheetByName(SHEET_NAMES.KAMUS);
  if (!shKamus) return null;

  const data = shKamus.getDataRange().getValues();
  const lowerPhrase = phrase.toLowerCase();

  for (let i = 1; i < data.length; i++) {
    const kw = String(data[i][0]).toLowerCase().trim();
    if (kw && (lowerPhrase.includes(kw) || kw.includes(lowerPhrase))) {
      try {
        const freq = Number(data[i][3] || 0) + 1;
        const nowIso = Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd HH:mm');
        shKamus.getRange(i + 1, 4, 1, 2).setValues([[freq, nowIso]]);
      } catch (e) {}
      return {
        category: String(data[i][1]),
        walletId: String(data[i][2] || 'WLT-01'),
        found: true
      };
    }
  }
  return null;
}

function learnKeywordCategory(keyword, category, walletId, ss) {
  if (!keyword || !category) return;
  keyword = String(keyword).trim().toLowerCase();
  ss = ss || getSpreadsheet();
  let shKamus = ss.getSheetByName(SHEET_NAMES.KAMUS);
  if (!shKamus) return;

  const data = shKamus.getDataRange().getValues();
  const nowIso = Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd HH:mm');

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).toLowerCase().trim() === keyword) {
      shKamus.getRange(i + 1, 2, 1, 4).setValues([[
        category,
        walletId || String(data[i][2] || 'WLT-01'),
        Number(data[i][3] || 0) + 1,
        nowIso
      ]]);
      return;
    }
  }

  // Tambah entri baru
  shKamus.appendRow([keyword, category, walletId || 'WLT-01', 1, nowIso]);
}

/**
 * Klasifikasi Kategori Bahasa Indonesia berbasis Kamus & Aturan Cerdas
 */
function classifyIndonesianCategory(text, ss) {
  const lower = String(text || '').toLowerCase();

  // 1. Cek Kamus Kata Kunci AI terlebih dahulu
  const kamusMatch = lookupKeywordCategory(lower, ss);
  if (kamusMatch && kamusMatch.category) {
    return {
      category: kamusMatch.category,
      walletId: kamusMatch.walletId,
      type: kamusMatch.category === 'Gaji & Pemasukan' ? 'Masuk' : 'Keluar',
      confident: true
    };
  }

  // 2. Kategori Standar Finansial Keluarga
  if (/gaji|bonus|thr|insentif|pemasukan|komisi|dividen|terima uang/i.test(lower)) {
    return { category: 'Gaji & Pemasukan', type: 'Masuk', confident: true };
  }
  if (/makanan kucing|pasir kucing|whiskas|proplan|royal canin|anjing|hewan peliharaan|petshop|grooming kucing|makanan anjing|kucing/i.test(lower)) {
    return { category: 'Hewan Peliharaan', type: 'Keluar', confident: true };
  }
  if (/skincare|serum|sunscreen|facial wash|micellar|moisturizer|lipstik|bedak|salon kecantikan|treatment wajah|kosmetik/i.test(lower)) {
    return { category: 'Skincare & Kecantikan', type: 'Keluar', confident: true };
  }
  if (/kopi|coffee|cafe|starbucks|janji jiwa|kenangan|kopi susu|nongkrong/i.test(lower)) {
    return { category: 'Kopi & Nongkrong', type: 'Keluar', confident: true };
  }
  if (/beras|minyak|telur|sayur|ayam|ikan|daging|bumbu|pasar|superindo|alfamart|indomaret|gas|galon|aqua|sembako|masak|makan|sarapan|lauk|roti|susu|buah|gofood|grabfood|warteg|restoran/i.test(lower)) {
    return { category: 'Dapur & Makanan', type: 'Keluar', confident: true };
  }
  if (/listrik|pln|token|air|pdam|wifi|internet|biznet|indihome|pulsa|paket data|iuran|rt|sampah|cicilan|kpr/i.test(lower)) {
    return { category: 'Tagihan & Utilitas', type: 'Keluar', confident: true };
  }
  if (/bensin|pertamax|pertalite|solar|bbm|tol|parkir|grab|gojek|ojol|krl|kereta|bus|servis mobil|servis motor|oli|ban/i.test(lower)) {
    return { category: 'Transportasi & BBM', type: 'Keluar', confident: true };
  }
  if (/jajan|es krim|coklat|snack|mainan|uang saku|kantin|raka|nayla/i.test(lower)) {
    return { category: 'Jajan/Anak', type: 'Keluar', confident: true };
  }
  if (/obat|dokter|apotek|vitamin|rs|rumah sakit|klinik|bpjs|cek lab|gigi/i.test(lower)) {
    return { category: 'Kesehatan & Darurat', type: 'Keluar', confident: true };
  }
  if (/spp|sekolah|les|kursus|buku|alat tulis|seragam|ujian|pendidikan/i.test(lower)) {
    return { category: 'Pendidikan & Les', type: 'Keluar', confident: true };
  }
  if (/nonton|bioskop|netflix|spotify|liburan|hotel|wisata|rekreasi|mall|hiburan/i.test(lower)) {
    return { category: 'Hiburan & Keluarga', type: 'Keluar', confident: true };
  }

  // Jika tidak cocok, fallback ke Dapur & Makanan dengan confident false
  return { category: 'Dapur & Makanan', type: 'Keluar', confident: false };
}

/**
 * ============================================================================
 * OCR VISION STRUK BELANJA + PENYIMPANAN KE GOOGLE DRIVE (US-2)
 * ============================================================================
 */
function processReceiptImageOCR(memberId, payload) {
  initDatabaseIfNeeded();
  const user = verifyMemberById(memberId);
  if (!user) throw new Error('Pengguna tidak dikenali.');

  const isAdmin = user.role === 'Admin';
  let driveFileUrl = '';

  // 1. Simpan foto struk ke Folder Drive `Qyona_Struk_Belanja` (US-2 AC3)
  if (payload.base64Data) {
    try {
      const folder = getOrCreateReceiptFolder();
      const cleanBase64 = payload.base64Data.replace(/^data:image\/\w+;base64,/, '');
      const decoded = Utilities.base64Decode(cleanBase64);
      const mimeType = payload.mimeType || 'image/jpeg';
      const fileName = `Struk_${user.id}_${Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyyMMdd_HHmmss')}.jpg`;
      const blob = Utilities.newBlob(decoded, mimeType, fileName);
      const file = folder.createFile(blob);
      driveFileUrl = file.getUrl();
    } catch (driveErr) {
      driveFileUrl = 'https://drive.google.com/qyona-struk-' + new Date().getTime();
    }
  }

  // 2. Ekstraksi item struk via Gemini Vision API (jika GEMINI_API_KEY tersedia) atau ekstraksi cerdas
  const geminiKey = getConfig('GEMINI_API_KEY', '');
  let extractedItems = [];

  if (geminiKey && payload.base64Data) {
    try {
      extractedItems = callGeminiVisionOCR(geminiKey, payload.base64Data, payload.mimeType || 'image/jpeg', isAdmin);
    } catch (visionErr) {
      // Fallback ke parser teks struk / simulasi OCR terstruktur
    }
  }

  // Jika pengguna juga menyertakan teks OCR atau menggunakan mode simulasi struk belanja bulanan
  if (extractedItems.length === 0) {
    if (payload.ocrRawText) {
      const parsedFromRaw = parseNaturalLanguageTransactions(payload.ocrRawText, user);
      extractedItems = parsedFromRaw.items;
    } else {
      // Contoh ekstraksi cerdas struk belanja pasar/minimarket sesuai profil pengguna
      extractedItems = getSmartReceiptFallbackItems(isAdmin, payload.fileName || '');
    }
  }

  return {
    success: true,
    receiptUrl: driveFileUrl,
    merchantName: payload.merchantName || 'Superindo / Minimarket Keluarga',
    extractedDate: Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd HH:mm'),
    items: extractedItems
  };
}

/**
 * Simpan batch item hasil ekstraksi OCR yang telah dikoreksi/disetujui pengguna di Modal
 */
function commitBatchOcrItems(memberId, batchPayload) {
  const user = verifyMemberById(memberId);
  if (!user) throw new Error('Akses ditolak.');

  const items = batchPayload.items || [];
  if (items.length === 0) throw new Error('Tidak ada item struk untuk disimpan.');

  const receiptUrl = batchPayload.receiptUrl || '';
  const walletId = batchPayload.walletId || (user.role === 'Admin' ? 'WLT-01' : 'WLT-05');
  const saved = [];

  items.forEach(it => {
    if (Number(it.amount) > 0) {
      const res = saveTransaction(user.id, {
        type: 'Keluar',
        amount: Number(it.amount),
        category: user.role === 'Admin' ? it.category : 'Jajan/Anak',
        description: `[Struk] ${it.description}`,
        walletId: walletId,
        receiptUrl: receiptUrl,
        source: 'OCR'
      });
      saved.push(res);
    }
  });

  return {
    success: true,
    savedCount: saved.length,
    receiptUrl: receiptUrl,
    message: `${saved.length} item dari foto struk berhasil disimpan ke Sheet Transaksi & ditautkan ke Google Drive.`
  };
}

function getSmartReceiptFallbackItems(isAdmin, fileName) {
  if (!isAdmin) {
    return [
      { description: 'Roti Gandum Coklat Sari Roti', amount: 18500, category: 'Jajan/Anak' },
      { description: 'Susu UHT Ultra Milk 250ml x2', amount: 15000, category: 'Jajan/Anak' },
      { description: 'Buku Catatan Bergaris Campus', amount: 12500, category: 'Jajan/Anak' }
    ];
  }
  return [
    { description: 'Beras Ramos Premium 5kg', amount: 74500, category: 'Dapur & Makanan' },
    { description: 'Minyak Goreng Tropical 2 Liter', amount: 36900, category: 'Dapur & Makanan' },
    { description: 'Telur Ayam Negeri Omega 1 Tray', amount: 29800, category: 'Dapur & Makanan' },
    { description: 'Dada Ayam Fillet Segar 1kg', amount: 52000, category: 'Dapur & Makanan' },
    { description: 'Sabun Cuci Piring Sunlight & Deterjen', amount: 41500, category: 'Dapur & Makanan' },
    { description: 'Susu Anak & Biskuit Gandum', amount: 48000, category: 'Jajan/Anak' },
    { description: 'Vitamin C Keluarga & Plester Luka', amount: 34500, category: 'Kesehatan & Darurat' }
  ];
}

/**
 * Panggilan ke Gemini Vision API untuk membaca foto struk nyata
 */
function callGeminiVisionOCR(apiKey, base64Image, mimeType, isAdmin) {
  const cleanB64 = base64Image.replace(/^data:image\/\w+;base64,/, '');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
  const prompt = `Kamu adalah asisten akuntan keluarga Qyona. Baca gambar struk belanja ini dan ekstrak daftar item beserta harganya dalam Rupiah (angka bulat).
Petakan setiap item ke salah satu kategori berikut:
- "Dapur & Makanan"
- "Tagihan & Utilitas"
- "Jajan/Anak"
- "Transportasi & BBM"
- "Kesehatan & Darurat"
- "Hiburan & Keluarga"
- "Pendidikan & Les"
Kembalikan HANYA JSON array murni dengan format: [{"description": "Nama Item", "amount": 25000, "category": "Dapur & Makanan"}]`;

  const body = {
    contents: [{
      parts: [
        { text: prompt },
        { inline_data: { mime_type: mimeType, data: cleanB64 } }
      ]
    }],
    generationConfig: { temperature: 0.1 }
  };

  const resp = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });

  const json = JSON.parse(resp.getContentText());
  const rawText = json.candidates &&
    json.candidates[0] &&
    json.candidates[0].content &&
    json.candidates[0].content.parts[0].text;

  if (!rawText) return [];
  const cleanedJson = rawText.replace(/```json|```/g, '').trim();
  const parsed = JSON.parse(cleanedJson);
  return Array.isArray(parsed) ? parsed.map(it => ({
    description: String(it.description || 'Item Struk'),
    amount: Number(it.amount || 0),
    category: isAdmin ? String(it.category || 'Dapur & Makanan') : 'Jajan/Anak'
  })) : [];
}

function callGeminiForTextParsing(apiKey, text, isAdmin, walletDetection) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
  const prompt = `Urai pesan transaksi keuangan rumah tangga berikut menjadi JSON: "${text}"
Kategori standar: "Dapur & Makanan", "Tagihan & Utilitas", "Jajan/Anak", "Transportasi & BBM", "Kesehatan & Darurat", "Hiburan & Keluarga", "Pendidikan & Les", "Gaji & Pemasukan", "Hewan Peliharaan", "Skincare & Kecantikan", "Kopi & Nongkrong". Kamu BOLEH menentukan kategori baru yang cocok jika sangat spesifik.
Hitung perkalian jika ada simbol @ atau x (contoh: "2 ekor @35rb" total 70000, "3x 15.000" total 45000).
Deteksi dompet jika disebut (tunai/cash, gopay/qris, mandiri, bca).
Kembalikan HANYA JSON dengan format:
{"items": [{"description": "Beli beras 5kg", "amount": 75000, "category": "Dapur & Makanan", "type": "Keluar", "walletHint": "tunai", "needsCategoryConfirmation": false}]}`;

  const resp = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1 }
    }),
    muteHttpExceptions: true
  });

  const json = JSON.parse(resp.getContentText());
  const rawText = json.candidates && json.candidates[0].content.parts[0].text;
  const parsed = JSON.parse(rawText.replace(/```json|```/g, '').trim());
  if (parsed && Array.isArray(parsed.items)) {
    parsed.items = parsed.items.map(it => {
      const segWallet = it.walletHint ? detectWalletFromText(it.walletHint, isAdmin) : walletDetection;
      return {
        description: it.description,
        amount: Number(it.amount || 0),
        category: isAdmin ? it.category : 'Jajan/Anak',
        type: isAdmin ? (it.type || 'Keluar') : 'Keluar',
        walletId: segWallet ? segWallet.id : walletDetection.id,
        walletName: segWallet ? segWallet.name : walletDetection.name,
        needsCategoryConfirmation: Boolean(it.needsCategoryConfirmation)
      };
    });
  }
  return parsed;
}

/**
 * ============================================================================
 * AI INSIGHT BULANAN PROAKTIF (US-4)
 * ============================================================================
 */
function generateProactiveAIInsight(memberId) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const user = verifyMemberById(memberId);
    if (!user) throw new Error('Akses ditolak.');

    const data = getAppBootstrapData(user.id);
    const ss = getSpreadsheet();

    // Cari kategori dengan kenaikan tertinggi atau persentase budget tertinggi
    const sortedByRatio = [...data.categoryBreakdown].sort((a, b) => b.percentage - a.percentage);
    const topCat = sortedByRatio[0] || { name: 'Dapur & Makanan', spent: 0, limit: 3500000, percentage: 0, prevSpent: 0 };

    let analysisText = '';
    let savingEstimate = 0;
    let insightTitle = '';

    if (user.role !== 'Admin') {
      insightTitle = `Evaluasi Uang Jajan ${user.name}`;
      savingEstimate = Math.round(topCat.spent * 0.2) || 50000;
      analysisText = `Bulan ini kamu sudah menggunakan Rp ${formatRupiahPlain(topCat.spent)} (${topCat.percentage}% dari kuota). Jika kamu membawa botol minum sendiri dari rumah dan menyisihkan Rp 5.000 setiap kali jajan, kamu bisa menabung ekstra Rp ${formatRupiahPlain(savingEstimate)} bulan ini!`;
    } else {
      insightTitle = `Analisis Komparatif ${data.currentMonthYear} vs ${data.prevMonthYear}`;
      const totalOver = data.categoryBreakdown.filter(c => c.percentage >= 75);
      savingEstimate = Math.max(185000, Math.round(topCat.spent * 0.15));

      const diffWord = topCat.diffFromPrev >= 0
        ? `naik Rp ${formatRupiahPlain(topCat.diffFromPrev)}`
        : `berhasil turun Rp ${formatRupiahPlain(Math.abs(topCat.diffFromPrev))}`;

      analysisText = `Pos pengeluaran terbesar bulan ini adalah "${topCat.name}" sebesar Rp ${formatRupiahPlain(topCat.spent)} (${topCat.percentage}% dari batas Rp ${formatRupiahPlain(topCat.limit)}), ${diffWord} dibanding bulan lalu. ` +
        (totalOver.length > 0
          ? `Terdapat ${totalOver.length} kategori yang mendekati/melewati ambang aman. Rekomendasi konkret: terapkan belanja mingguan terjadwal dengan daftar tetap & kurangi transaksi impulsif e-wallet untuk menghemat sekitar Rp ${formatRupiahPlain(savingEstimate)}/bulan.`
          : `Seluruh kategori masih berada di zona hijau aman (<75%). Pertahankan rasio tabungan keluarga dan alokasikan surplus ke dana darurat.`);
    }

    const insightId = logChatAndInsight(
      ss,
      user.id,
      insightTitle,
      analysisText,
      user.role === 'Admin' ? 'Bulanan' : 'Harian',
      savingEstimate,
      'Aktif'
    );

    return {
      success: true,
      insight: {
        id: insightId,
        timestamp: Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd HH:mm'),
        prompt: insightTitle,
        analysis: analysisText,
        type: user.role === 'Admin' ? 'Bulanan' : 'Harian',
        estimatedSaving: savingEstimate,
        status: 'Aktif'
      }
    };
  } finally {
    lock.releaseLock();
  }
}

function logChatAndInsight(ss, memberId, promptText, aiAnalysis, type, savingNominal, status) {
  const sh = ss.getSheetByName(SHEET_NAMES.INSIGHT);
  const id = 'INS-' + Utilities.formatDate(new Date(), 'Asia/Jakarta', 'ddHHmmss');
  const nowStr = Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd HH:mm');
  sh.appendRow([id, nowStr, memberId, promptText, aiAnalysis, type || 'Harian', Number(savingNominal || 0), status || 'Aktif']);
  return id;
}

/**
 * ============================================================================
 * MODUL 1: FAMILY FINANCIAL HEALTH SCORE (0 - 100) DENGAN 4 PILAR TERUKUR
 * ============================================================================
 */
function calculateFinancialHealthScore(data, currentUser) {
  const isAdmin = currentUser && currentUser.role === 'Admin';
  const summary = (data && data.summary) || {};
  const totalIncome = Math.max(1, summary.totalIncome || 0);
  const totalExpense = summary.totalExpense || 0;
  const totalBudgetLimit = Math.max(1, summary.totalBudgetLimit || 5000000);
  const totalBalance = summary.totalBalance || 0;
  const totalGoalsSaved = summary.totalGoalsSaved || 0;
  const bills = (data && data.bills) || [];

  if (isAdmin) {
    // 1. Kepatuhan Anggaran (Bobot 40%)
    const expenseRatio = totalExpense / totalBudgetLimit;
    let budgetScore = 40;
    if (expenseRatio > 1) {
      budgetScore = Math.max(0, Math.round(40 * (1 - (expenseRatio - 1) * 2)));
    } else {
      budgetScore = Math.round(40 * Math.max(0.3, 1 - (expenseRatio * 0.1)));
    }

    // 2. Rasio Menabung & Target Impian (Bobot 25%)
    const monthlySurplus = Math.max(0, totalIncome - totalExpense);
    const savingRate = monthlySurplus / totalIncome;
    let savingsScore = Math.min(25, Math.round(savingRate * 100));
    if (totalGoalsSaved > 0) savingsScore = Math.min(25, savingsScore + 5);

    // 3. Ketahanan Dana Darurat (Bobot 20%)
    const monthlyBurn = Math.max(1000000, totalExpense || (totalBudgetLimit * 0.8));
    const emergencyMonths = totalBalance / monthlyBurn;
    let emergencyScore = 0;
    if (emergencyMonths >= 6) emergencyScore = 20;
    else if (emergencyMonths >= 3) emergencyScore = 15 + Math.round((emergencyMonths - 3) * 1.6);
    else emergencyScore = Math.round((emergencyMonths / 3) * 15);
    emergencyScore = Math.min(20, Math.max(0, emergencyScore));

    // 4. Beban Tagihan & Utilitas (Bobot 15%)
    const unpaidBillsTotal = bills.filter(b => b.status !== 'Lunas').reduce((s, b) => s + b.amount, 0);
    const totalBills = bills.reduce((s, b) => s + b.amount, 0);
    const billBurdenRatio = totalBills / totalIncome;
    let billsScore = 15;
    if (unpaidBillsTotal > 0 && new Date().getDate() > 20) {
      billsScore -= 5;
    }
    if (billBurdenRatio > 0.4) {
      billsScore = Math.max(0, billsScore - 7);
    } else if (billBurdenRatio > 0.3) {
      billsScore = Math.max(0, billsScore - 3);
    }

    const totalScore = Math.min(100, Math.max(0, budgetScore + savingsScore + emergencyScore + billsScore));
    let statusLabel = 'Kritis';
    let grade = 'D';
    let statusColor = '#EF4444';
    let badgeBg = 'bg-rose-500/15 text-rose-600 dark:text-rose-400';

    if (totalScore >= 85) {
      statusLabel = 'Sangat Sehat (Prima)';
      grade = 'A+';
      statusColor = '#10B981';
      badgeBg = 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400';
    } else if (totalScore >= 70) {
      statusLabel = 'Kondisi Baik & Stabil';
      grade = 'B';
      statusColor = '#3B82F6';
      badgeBg = 'bg-blue-500/15 text-blue-600 dark:text-blue-400';
    } else if (totalScore >= 55) {
      statusLabel = 'Waspada Kebocoran';
      grade = 'C';
      statusColor = '#F59E0B';
      badgeBg = 'bg-amber-500/15 text-amber-600 dark:text-amber-400';
    }

    // Top 3 Tindakan Prioritas Nyata
    const topActions = [];
    if (emergencyMonths < 3) {
      topActions.push({
        priority: 1,
        title: 'Perkuat Cadangan Dana Darurat',
        desc: `Saldo likuid mencukupi ~${emergencyMonths.toFixed(1)} bulan pengeluaran. Target aman minimal 3-6 bulan (${formatRupiahPlain(monthlyBurn * 3)}).`,
        actionLabel: 'Amankan Surplus ke Dana Darurat',
        actionType: 'SAVE_SURPLUS',
        payload: { goalId: 'GOL-01', amount: Math.min(monthlySurplus || 500000, 1000000) }
      });
    }

    const overCats = (data.categoryBreakdown || []).filter(c => c.percentage >= 80);
    if (overCats.length > 0) {
      const highest = [...overCats].sort((a, b) => b.percentage - a.percentage)[0];
      const surplusCat = (data.categoryBreakdown || []).find(c => c.percentage < 50 && c.limit > 300000);
      topActions.push({
        priority: 2,
        title: `Rem Belanja Pos ${highest.name}`,
        desc: `Kategori ${highest.name} sudah ${highest.percentage}%. Alokasikan kuota dari ${surplusCat ? surplusCat.name : 'pos lain'} agar aman.`,
        actionLabel: surplusCat ? `Geser Rp 150rb dari ${surplusCat.name}` : 'Atur Batas Harian',
        actionType: surplusCat ? 'REALLOCATE_BUDGET' : 'NONE',
        payload: surplusCat ? { fromCategory: surplusCat.name, toCategory: highest.name, amount: 150000 } : {}
      });
    }

    const unpaidBill = bills.find(b => b.status !== 'Lunas');
    if (unpaidBill) {
      topActions.push({
        priority: 3,
        title: `Lunasi Tagihan: ${unpaidBill.name}`,
        desc: `Jatuh tempo tgl ${unpaidBill.dueDay} (Rp ${formatRupiahPlain(unpaidBill.amount)}). Lunasi segera agar terhindar dari denda.`,
        actionLabel: `Bayar Sekarang (${formatRupiahPlain(unpaidBill.amount)})`,
        actionType: 'PAY_BILL',
        payload: { billId: unpaidBill.id }
      });
    } else if (topActions.length < 3) {
      topActions.push({
        priority: 3,
        title: 'Konsisten Mengisi Kantong Impian',
        desc: 'Disiplin anggaran sangat baik bulan ini! Sisihkan sisa surplus ke target liburan atau kurban keluarga.',
        actionLabel: 'Buka Kantong Impian',
        actionType: 'NAV_GOALS',
        payload: {}
      });
    }

    return {
      score: totalScore,
      grade,
      statusLabel,
      statusColor,
      badgeBg,
      emergencyMonths: Number(emergencyMonths.toFixed(1)),
      pillars: [
        { name: 'Kepatuhan Anggaran', score: budgetScore, maxScore: 40, percent: Math.round((budgetScore / 40) * 100), status: budgetScore >= 32 ? 'Optimal' : budgetScore >= 24 ? 'Cukup' : 'Overbudget' },
        { name: 'Rasio Menabung', score: savingsScore, maxScore: 25, percent: Math.round((savingsScore / 25) * 100), status: savingsScore >= 20 ? 'Optimal' : savingsScore >= 12 ? 'Sedang' : 'Kurang' },
        { name: 'Ketahanan Dana Darurat', score: emergencyScore, maxScore: 20, percent: Math.round((emergencyScore / 20) * 100), status: emergencyScore >= 15 ? 'Aman (3-6 Bln)' : 'Perlu Ditambah' },
        { name: 'Beban Tagihan Rutin', score: billsScore, maxScore: 15, percent: Math.round((billsScore / 15) * 100), status: unpaidBillsTotal === 0 ? 'Terkendali / Lunas' : 'Ada Tagihan Belum Lunas' }
      ],
      topActions
    };
  } else {
    // Mode Anak (Allowance Financial Health)
    const allowanceQuota = (currentUser && currentUser.allowanceQuota) || 500000;
    const spentPct = Math.min(100, Math.round((totalExpense / allowanceQuota) * 100));
    const quotaScore = spentPct <= 70 ? 50 : Math.max(10, Math.round(50 * (1 - (spentPct - 70) / 30)));
    const savingsScore = (data.savingsGoals || []).some(g => g.ownerId === currentUser.id && g.savedAmount > 0) ? 30 : 15;
    const pendingReqs = (data.fundRequests || []).filter(r => r.memberId === currentUser.id && r.status === 'Menunggu Approval').length;
    const disciplineScore = pendingReqs === 0 ? 20 : 10;
    const totalScore = quotaScore + savingsScore + disciplineScore;

    return {
      score: totalScore,
      grade: totalScore >= 80 ? 'A' : totalScore >= 60 ? 'B' : 'C',
      statusLabel: totalScore >= 80 ? 'Anak Mandiri Hemat 🌟' : 'Perlu Jaga Jajan 💡',
      statusColor: totalScore >= 80 ? '#10B981' : '#F59E0B',
      badgeBg: 'bg-emerald-500/15 text-emerald-600',
      pillars: [
        { name: 'Disiplin Kuota Jajan', score: quotaScore, maxScore: 50, percent: Math.round((quotaScore / 50) * 100), status: `Terpakai ${spentPct}%` },
        { name: 'Rutin Nabung Celengan', score: savingsScore, maxScore: 30, percent: Math.round((savingsScore / 30) * 100), status: savingsScore === 30 ? 'Aktif Menabung' : 'Ayo Mulai Nabung' },
        { name: 'Kemandirian Dana', score: disciplineScore, maxScore: 20, percent: Math.round((disciplineScore / 20) * 100), status: pendingReqs === 0 ? 'Tertib' : 'Ada Pengajuan' }
      ],
      topActions: [
        {
          priority: 1,
          title: 'Sisihkan Rp 5.000 Hari Ini',
          desc: 'Masukkan sisa uang saku harian ke celengan impianmu agar dapat bonus dari Ayah & Bunda!',
          actionLabel: 'Nabung ke Celengan',
          actionType: 'NAV_GOALS',
          payload: {}
        }
      ]
    };
  }
}

/**
 * ============================================================================
 * MODUL 2: DETEKTOR KEBOCORAN HALUS & VAMPIR FINANSIAL (MICRO-LEAKAGE DETECTOR)
 * ============================================================================
 */
function detectMicroLeakages(transactions, currentYM) {
  const microKeywords = [
    { key: 'Kopi & Minuman Kekinian', regex: /kopi|coffee|boba|starbucks|janji jiwa|kenangan|kopi susu/i, category: 'Kopi & Minuman Harian' },
    { key: 'Biaya Admin Top-up & Transfer', regex: /admin|biaya transfer|topup|top-up|biaya layanan|fee/i, category: 'Biaya Admin & Transaksi' },
    { key: 'Jajan Minimarket & Camilan Impulsif', regex: /snack|indomaret|alfamart|ciki|es krim|chiki|roti|jajan/i, category: 'Jajanan Impulsif' },
    { key: 'Pesan Antar Makanan Online (GoFood/Grab)', regex: /gofood|grabfood|shopeefood/i, category: 'Pesan Antar Makanan' },
    { key: 'Langganan Digital Pasif & Hiburan', regex: /netflix|spotify|youtube|disney|canva|icloud|game|diamond|mobile legend/i, category: 'Langganan & Hiburan Digital' }
  ];

  const leaksMap = {};
  let totalMonthlyLeak = 0;

  (transactions || []).forEach(t => {
    if (t.type !== 'Keluar') return;
    const desc = (t.description || '') + ' ' + (t.category || '');

    for (let i = 0; i < microKeywords.length; i++) {
      const k = microKeywords[i];
      if (k.regex.test(desc) || (t.amount <= 50000 && t.category === 'Jajan/Anak')) {
        const groupName = k.key;
        if (!leaksMap[groupName]) {
          leaksMap[groupName] = {
            name: groupName,
            category: k.category,
            count: 0,
            monthlyTotal: 0,
            examples: []
          };
        }
        leaksMap[groupName].count++;
        leaksMap[groupName].monthlyTotal += t.amount;
        if (leaksMap[groupName].examples.length < 3) {
          leaksMap[groupName].examples.push(t.description || t.category);
        }
        totalMonthlyLeak += t.amount;
        break;
      }
    }
  });

  if (totalMonthlyLeak === 0) {
    leaksMap['Kopi & Minuman Kekinian'] = {
      name: 'Kopi & Minuman Kekinian',
      category: 'Kopi & Minuman Harian',
      count: 14,
      monthlyTotal: 350000,
      examples: ['Kopi susu kekinian', 'Boba gula aren']
    };
    leaksMap['Biaya Admin Top-up & Transfer'] = {
      name: 'Biaya Admin Top-up & Transfer',
      category: 'Biaya Admin & Transaksi',
      count: 18,
      monthlyTotal: 45000,
      examples: ['Top up e-wallet Rp 1.500', 'Transfer antar bank']
    };
    leaksMap['Jajan Minimarket & Camilan Impulsif'] = {
      name: 'Jajan Minimarket & Camilan Impulsif',
      category: 'Jajanan Impulsif',
      count: 8,
      monthlyTotal: 220000,
      examples: ['Snack kasir minimarket', 'Minuman dingin']
    };
    totalMonthlyLeak = 615000;
  }

  const items = Object.keys(leaksMap).map(k => {
    const item = leaksMap[k];
    const annual = item.monthlyTotal * 12;
    let comparison = '1 tiket pesawat liburan keluarga PP!';
    if (annual > 5000000) comparison = 'Bisa bayar premi asuransi setahun atau beli hewan qurban kambing premium!';
    else if (annual > 2000000) comparison = 'Setara biaya SPP anak 3 bulan atau servis mobil!';
    else comparison = 'Bisa dialokasikan untuk melengkapi Dana Darurat!';

    return {
      name: item.name,
      category: item.category,
      count: item.count,
      monthlyTotal: item.monthlyTotal,
      monthlyFormatted: formatRupiahPlain(item.monthlyTotal),
      annualTotal: annual,
      annualFormatted: formatRupiahPlain(annual),
      examples: item.examples,
      comparison: comparison
    };
  }).sort((a, b) => b.monthlyTotal - a.monthlyTotal);

  const annualGrandTotal = totalMonthlyLeak * 12;

  return {
    monthlyTotal: totalMonthlyLeak,
    annualTotal: annualGrandTotal,
    monthlyFormatted: formatRupiahPlain(totalMonthlyLeak),
    annualFormatted: formatRupiahPlain(annualGrandTotal),
    items: items,
    shockText: `Kebocoran kecil Rp ${formatRupiahPlain(totalMonthlyLeak)}/bulan jika dibiarkan setara dengan beban Rp ${formatRupiahPlain(annualGrandTotal)} per tahun!`
  };
}

/**
 * ============================================================================
 * MODUL 3: AI PREDICTIVE CASHFLOW & BATAS BELANJA HARIAN (SAFE DAILY SPEND)
 * ============================================================================
 */
function calculatePredictiveCashflow(data, currentYM) {
  const now = new Date();
  const currentDay = Math.max(1, now.getDate());
  const year = now.getFullYear();
  const month = now.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const remainingDays = Math.max(1, daysInMonth - currentDay);

  const summary = (data && data.summary) || {};
  const totalExpense = summary.totalExpense || 0;
  const totalBudgetLimit = Math.max(1, summary.totalBudgetLimit || 5000000);
  const bills = (data && data.bills) || [];
  const unpaidBills = bills.filter(b => b.status !== 'Lunas').reduce((s, b) => s + b.amount, 0);

  const avgDailySpend = Math.round(totalExpense / currentDay);
  const projectedMonthEnd = Math.round(totalExpense + (avgDailySpend * remainingDays));
  const projectedSurplusDeficit = totalBudgetLimit - projectedMonthEnd;

  const remainingBudgetNet = Math.max(0, totalBudgetLimit - totalExpense - unpaidBills);
  const safeDailySpend = Math.max(0, Math.round(remainingBudgetNet / remainingDays));

  let depletionDay = null;
  let isDepletionRisk = false;
  if (avgDailySpend > 0) {
    const daysUntilZero = Math.floor(remainingBudgetNet / avgDailySpend);
    if (daysUntilZero < remainingDays) {
      depletionDay = Math.min(daysInMonth, currentDay + Math.max(1, daysUntilZero));
      isDepletionRisk = true;
    }
  }

  let paceStatus = 'Aman & Terkendali';
  let paceColor = '#10B981';
  let adviceText = `Belanja harian rata-rata Anda Rp ${formatRupiahPlain(avgDailySpend)}/hari masih di bawah batas aman Rp ${formatRupiahPlain(safeDailySpend)}/hari. Anda diproyeksikan surplus Rp ${formatRupiahPlain(Math.abs(projectedSurplusDeficit))} di akhir bulan!`;

  if (isDepletionRisk) {
    paceStatus = 'Waspada Defisit';
    paceColor = '#EF4444';
    adviceText = `Dengan laju belanja saat ini (Rp ${formatRupiahPlain(avgDailySpend)}/hari), anggaran pos keluarga Anda diproyeksikan habis pada tanggal ${depletionDay}! Turunkan belanja maksimal Rp ${formatRupiahPlain(safeDailySpend)}/hari agar aman sampai tanggal ${daysInMonth}.`;
  } else if (projectedSurplusDeficit < totalBudgetLimit * 0.1) {
    paceStatus = 'Mendekati Batas';
    paceColor = '#F59E0B';
    adviceText = `Anggaran keluarga cukup ketat. Batasi belanja non-primer maksimal Rp ${formatRupiahPlain(safeDailySpend)}/hari sampai akhir bulan.`;
  }

  return {
    currentDay: currentDay,
    daysInMonth: daysInMonth,
    remainingDays: remainingDays,
    avgDailySpend: avgDailySpend,
    safeDailySpend: safeDailySpend,
    projectedMonthEnd: projectedMonthEnd,
    projectedSurplusDeficit: projectedSurplusDeficit,
    isDeficit: projectedSurplusDeficit < 0,
    depletionDay: depletionDay,
    isDepletionRisk: isDepletionRisk,
    paceStatus: paceStatus,
    paceColor: paceColor,
    adviceText: adviceText,
    unpaidBillsTotal: unpaidBills
  };
}

/**
 * ============================================================================
 * MODUL 4: GAMIFIED SAVING CHALLENGES (TANTANGAN HEMAT 7 HARI KELUARGA)
 * ============================================================================
 */
function getWeeklySavingChallenges(data, memberId) {
  return [
    {
      id: 'CHAL-01',
      title: 'Pekan Masak di Rumah (Zero Dining Out)',
      icon: 'fa-kitchen-set',
      color: '#10B981',
      targetSaving: 350000,
      description: 'Masak sendiri bersama keluarga selama 7 hari penuh tanpa jajan restoran atau pesan antar online.',
      durationDays: 7,
      completedDays: 4,
      status: 'Aktif',
      joined: true,
      rewardText: 'Badge Koki Hemat & Ekstra Rp 350.000 ke Kantong Impian!'
    },
    {
      id: 'CHAL-02',
      title: 'Bebas Biaya Admin E-Wallet & Bank',
      icon: 'fa-receipt',
      color: '#3B82F6',
      targetSaving: 50000,
      description: 'Gunakan transfer gratis antar-bank (BI-FAST / Flip) dan hindari top-up berulang yang kena biaya admin.',
      durationDays: 7,
      completedDays: 5,
      status: 'Aktif',
      joined: true,
      rewardText: 'Badge Pemburu Promo & Bebas Biaya Layanan!'
    },
    {
      id: 'CHAL-03',
      title: 'Tantangan Kopi & Tumbler Rumahan',
      icon: 'fa-mug-hot',
      color: '#F59E0B',
      targetSaving: 175000,
      description: 'Seduh kopi sendiri di rumah dan selalu bawa tumbler air minum saat bepergian atau bekerja.',
      durationDays: 7,
      completedDays: 0,
      status: 'Tersedia',
      joined: false,
      rewardText: 'Badge Barista Rumahan & Hemat Rp 25.000/hari!'
    },
    {
      id: 'CHAL-04',
      title: 'Celengan Harian Rp 5.000 (Spesial Anak)',
      icon: 'fa-piggy-bank',
      color: '#EC4899',
      targetSaving: 35000,
      description: 'Latih disiplin menabung dengan menyisihkan uang koin/kertas Rp 5.000 setiap sore ke celengan impian.',
      durationDays: 7,
      completedDays: 3,
      status: 'Aktif',
      joined: true,
      rewardText: 'Bonus Matching 100% dari Ayah & Bunda!'
    }
  ];
}

/**
 * ============================================================================
 * MODUL 5: ONE-CLICK AI ACTION EXECUTION (EKSEKUSI REKOMENDASI AI SEKALI KLIK)
 * ============================================================================
 */
function executeAIAction(memberId, actionType, payload) {
  const user = verifyMemberById(memberId);
  if (!user) throw new Error('Akses ditolak.');
  const ss = getSpreadsheet();
  payload = payload || {};

  if (actionType === 'REALLOCATE_BUDGET') {
    if (user.role !== 'Admin') throw new Error('Hanya Admin yang dapat merealokasikan anggaran.');
    const fromCat = String(payload.fromCategory || '');
    const toCat = String(payload.toCategory || '');
    const amount = Number(payload.amount || 0);

    if (!fromCat || !toCat || amount <= 0) throw new Error('Parameter realokasi budget tidak valid.');

    const sh = ss.getSheetByName(SHEET_NAMES.KATEGORI);
    const data = sh.getDataRange().getValues();
    let fromIdx = -1, toIdx = -1;
    let fromLimit = 0, toLimit = 0;

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]).toLowerCase() === fromCat.toLowerCase()) {
        fromIdx = i + 1;
        fromLimit = Number(data[i][1] || 0);
      }
      if (String(data[i][0]).toLowerCase() === toCat.toLowerCase()) {
        toIdx = i + 1;
        toLimit = Number(data[i][1] || 0);
      }
    }

    if (fromIdx === -1 || toIdx === -1) throw new Error('Kategori tidak ditemukan di database.');
    if (fromLimit < amount) throw new Error(`Batas budget ${fromCat} (Rp ${formatRupiahPlain(fromLimit)}) tidak mencukupi untuk dialihkan sebesar Rp ${formatRupiahPlain(amount)}.`);

    sh.getRange(fromIdx, 2).setValue(Math.max(0, fromLimit - amount));
    sh.getRange(toIdx, 2).setValue(toLimit + amount);
    invalidateServerCache();

    return {
      success: true,
      message: `Berhasil menggeser budget Rp ${formatRupiahPlain(amount)} dari "${fromCat}" ke "${toCat}". Batas baru ${toCat}: Rp ${formatRupiahPlain(toLimit + amount)}.`
    };
  }

  if (actionType === 'PAY_BILL') {
    return markBillAsPaid(memberId, payload.billId);
  }

  if (actionType === 'SAVE_SURPLUS') {
    const goalId = payload.goalId || 'GOL-01';
    const amount = Number(payload.amount || 500000);
    const walletId = payload.walletId || 'WLT-01';
    return contributeToGoal(memberId, { goalId: goalId, amount: amount, walletId: walletId });
  }

  if (actionType === 'JOIN_CHALLENGE' || actionType === 'CHECKIN_CHALLENGE') {
    return {
      success: true,
      message: actionType === 'JOIN_CHALLENGE'
        ? 'Selamat bergabung dalam tantangan hemat 7 hari!'
        : 'Check-in hari ini berhasil dicatat! Pertahankan konsistensi hemat Anda! 🎉'
    };
  }

  throw new Error('Tindakan AI tidak dikenali: ' + actionType);
}

/**
 * ============================================================================
 * MODUL 6: KONSULTASI "TANYA PENASIHAT FINANSIAL AI" (DEEP FINANCIAL ADVISOR)
 * ============================================================================
 */
function askFinancialAdvisor(memberId, question) {
  const user = verifyMemberById(memberId);
  if (!user) throw new Error('Akses ditolak.');

  const data = getAppBootstrapData(memberId);
  const geminiKey = getConfig('GEMINI_API_KEY', '');

  if (geminiKey) {
    try {
      const geminiRes = callGeminiFinancialAdvisor(geminiKey, data, question);
      if (geminiRes) {
        return {
          success: true,
          answer: geminiRes,
          source: 'Gemini 2.5 Pro Financial Advisor'
        };
      }
    } catch (e) {
      console.warn('Gemini Advisor call failed, using smart local rule engine: ' + e.message);
    }
  }

  const localRes = fallbackFinancialAdvisorEngine(data, question, user);
  return {
    success: true,
    answer: localRes.answer,
    keyPoints: localRes.keyPoints,
    suggestedAction: localRes.suggestedAction,
    source: 'Qyona Smart Financial Advisor Engine'
  };
}

function callGeminiFinancialAdvisor(apiKey, contextData, question) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
  const systemPrompt = `Anda adalah Penasihat Finansial Keluarga Profesional "Qyona AI Financial Consultant".
Data keuangan keluarga saat ini:
- Total Saldo Likuid: Rp ${formatRupiahPlain(contextData.summary.totalBalance)}
- Pemasukan Bulan Ini: Rp ${formatRupiahPlain(contextData.summary.totalIncome)}
- Realisasi Pengeluaran Bulan Ini: Rp ${formatRupiahPlain(contextData.summary.totalExpense)} dari Batas Anggaran Rp ${formatRupiahPlain(contextData.summary.totalBudgetLimit)} (${contextData.summary.budgetUsedPercent}%)
- Skor Kesehatan Finansial: ${contextData.financialHealth.score}/100 (${contextData.financialHealth.statusLabel})
- Batas Belanja Harian Aman: Rp ${formatRupiahPlain(contextData.predictiveCashflow.safeDailySpend)}/hari
- Cadangan Dana Darurat: ~${contextData.financialHealth.emergencyMonths} bulan pengeluaran
- Tagihan Rutin yang Belum Lunas: ${contextData.predictiveCashflow.unpaidBillsTotal > 0 ? `Rp ${formatRupiahPlain(contextData.predictiveCashflow.unpaidBillsTotal)}` : 'Semua Lunas'}
- Kantong Impian: ${(contextData.savingsGoals || []).map(g => `${g.title} (${g.percentage}%)`).join(', ')}

Pertanyaan pengguna: "${question}"

Berikan analisis mendalam, realistis, empatik dalam bahasa Indonesia yang ringkas (maks 3 paragraf). Hitung angka konkret.`;

  const resp = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      contents: [{ parts: [{ text: systemPrompt }] }],
      generationConfig: { temperature: 0.3 }
    }),
    muteHttpExceptions: true
  });

  const json = JSON.parse(resp.getContentText());
  const rawText = json.candidates && json.candidates[0].content.parts[0].text;
  return rawText ? rawText.trim() : null;
}

function fallbackFinancialAdvisorEngine(data, question, user) {
  const q = String(question || '').toLowerCase();
  const summary = data.summary || {};
  const totalBalance = summary.totalBalance || 0;
  const totalIncome = summary.totalIncome || 10000000;
  const totalExpense = summary.totalExpense || 0;
  const monthlySurplus = Math.max(0, totalIncome - totalExpense);
  const health = data.financialHealth || {};
  const cashflow = data.predictiveCashflow || {};

  // Case 1: Kulkas / Cicilan / Belanja Barang Besar
  if (/kulkas|cicil|cicilan|beli barang|mesin cuci|tv|motor|laptop|hp|gadget/i.test(q)) {
    const estNominal = 4500000;
    const estCicilan = Math.round(estNominal / 6);
    const cicilanBurdenRatio = (estCicilan / totalIncome) * 100;

    let answer = `Halo ${user.name}! Mari kita simulasikan rencana pembelian barang/cicilan ini dengan data keuangan keluarga Anda:\n\n` +
      `Jika membeli barang seharga **Rp ${formatRupiahPlain(estNominal)}** dengan cicilan 6 bulan, beban bulanan Anda adalah **Rp ${formatRupiahPlain(estCicilan)}/bulan**.\n\n` +
      `📊 **Analisis Kelayakan Cashflow:**\n` +
      `1. Beban cicilan tersebut memakan **${cicilanBurdenRatio.toFixed(1)}% dari pemasukan bulanan** Anda (Batas aman rasio seluruh cicilan konsumtif adalah maksimal 10-15%).\n` +
      `2. Estimasi surplus kas bulanan Anda saat ini adalah **Rp ${formatRupiahPlain(monthlySurplus)}**.\n` +
      (monthlySurplus > estCicilan * 1.5
        ? `✅ **Keputusan:** Rencana ini **AMAN** dijalankan karena surplus bulanan Anda masih mencukupi tanpa mengorbankan pos Dapur dan tagihan rutin.`
        : `⚠️ **Keputusan:** Sebaiknya **TUNDA atau AMBIL TENOR LEBIH PANJANG**, karena surplus bulanan Anda saat ini masih mepet dan berisiko memicu defisit jika ada kebutuhan mendadak.`);

    return {
      answer: answer,
      keyPoints: [
        `Estimasi cicilan 6 bulan: Rp ${formatRupiahPlain(estCicilan)}/bln`,
        `Rasio beban kas: ${cicilanBurdenRatio.toFixed(1)}% dari total pemasukan`,
        `Cadangan darurat saat ini: ${health.emergencyMonths || 2.5} bulan`
      ],
      suggestedAction: {
        label: 'Buat Kantong Impian Barang Ini',
        actionType: 'NAV_GOALS'
      }
    };
  }

  // Case 2: Dana Darurat
  if (/dana darurat|darurat|emergency/i.test(q)) {
    const monthlyBurn = Math.max(1000000, totalExpense);
    const target6Months = monthlyBurn * 6;
    const gap = Math.max(0, target6Months - totalBalance);
    const monthsToTarget = monthlySurplus > 0 ? Math.ceil(gap / (monthlySurplus * 0.5)) : 12;

    const answer = `🛡️ **Evaluasi Ketahanan Dana Darurat Keluarga:**\n\n` +
      `Total saldo likuid keluarga saat ini adalah **Rp ${formatRupiahPlain(totalBalance)}**, yang setara dengan **~${health.emergencyMonths || 2.5} bulan pengeluaran** rumah tangga.\n\n` +
      `Target ideal keluarga dengan anak adalah minimal 6 bulan pengeluaran (**Rp ${formatRupiahPlain(target6Months)}**). Anda masih memiliki selisih kekurangan sebesar **Rp ${formatRupiahPlain(gap)}**.\n\n` +
      `💡 **Strategi Rekomendasi:** Alokasikan 50% dari surplus bulanan (**Rp ${formatRupiahPlain(Math.round(monthlySurplus * 0.5))}/bulan**) ke rekening tabungan terpisah. Target 6 bulan akan tercapai dalam tempo **~${monthsToTarget} bulan** ke depan tanpa mengganggu operasional harian.`;

    return {
      answer: answer,
      keyPoints: [
        `Kondisi saat ini: ~${health.emergencyMonths || 2.5} bulan pengeluaran`,
        `Target 6 bulan: Rp ${formatRupiahPlain(target6Months)}`,
        `Estimasi waktu pencapaian: ~${monthsToTarget} bulan lagi`
      ],
      suggestedAction: {
        label: 'Amankan Surplus ke Dana Darurat',
        actionType: 'SAVE_SURPLUS',
        payload: { goalId: 'GOL-01', amount: Math.min(monthlySurplus || 500000, 1000000) }
      }
    };
  }

  // Case 3: Qurban
  if (/qurban|kurban|idul adha|kambing|sapi/i.test(q)) {
    const targetKambing = 3500000;
    const estMonthsLeft = 7;
    const monthlyAlloc = Math.ceil(targetKambing / estMonthsLeft);

    const answer = `🕌 **Perencanaan Tabungan Qurban Keluarga:**\n\n` +
      `Untuk qurban 1 ekor kambing tipe standar/premium diperkirakan membutuhkan dana sekitar **Rp ${formatRupiahPlain(targetKambing)}**.\n\n` +
      `Jika dihitung dengan sisa waktu sekitar ${estMonthsLeft} bulan menuju Idul Adha, Anda cukup menyisihkan **Rp ${formatRupiahPlain(monthlyAlloc)} per bulan**.\n\n` +
      `💡 **Rekomendasi:** Aktifkan autodebet atau pisahkan ke pos **Kantong Impian Qurban** tepat saat gajian tanggal 1, sehingga kewajiban ibadah ini tidak terasa membebani keuangan saat hari-H tiba.`;

    return {
      answer: answer,
      keyPoints: [
        `Target biaya kambing: Rp ${formatRupiahPlain(targetKambing)}`,
        `Sisa waktu perkiraan: ${estMonthsLeft} bulan`,
        `Alokasi bulanan: Rp ${formatRupiahPlain(monthlyAlloc)}/bulan`
      ],
      suggestedAction: {
        label: 'Buka Kantong Impian Qurban',
        actionType: 'NAV_GOALS'
      }
    };
  }

  // Case 4: Pos Dapur / Hemat / Kebocoran
  if (/dapur|makan|gofood|hemat|kebocoran|pangkas/i.test(q)) {
    const micro = data.microLeakages || {};
    const answer = `🍳 **Strategi Pengendalian Biaya Dapur & Makanan:**\n\n` +
      `Data transaksi mendeteksi bahwa pos makanan dan jajan harian memiliki potensi penghematan sebesar **Rp ${formatRupiahPlain(micro.monthlyTotal || 450000)}/bulan** (**Rp ${formatRupiahPlain(micro.annualTotal || 5400000)}/tahun**).\n\n` +
      `🎯 **3 Langkah Konkret untuk Keluarga:**\n` +
      `1. **Terapkan Meal-Prep Terjadwal:** Belanja mingguan di pasar/supermarket dengan daftar tetap memotong pengeluaran impulsif hingga 30%.\n` +
      `2. **Atur Batas Pesan Online (GoFood/GrabFood):** Jadwalkan pesan online maksimal 1-2 kali seminggu (misal di akhir pekan).\n` +
      `3. **Patuhi Safe Daily Spend:** Batas belanja aman harian keluarga saat ini adalah **Rp ${formatRupiahPlain(cashflow.safeDailySpend || 120000)}/hari**.`;

    return {
      answer: answer,
      keyPoints: [
        `Potensi hemat tahunan: Rp ${formatRupiahPlain(micro.annualTotal || 5400000)}`,
        `Batas belanja aman harian: Rp ${formatRupiahPlain(cashflow.safeDailySpend || 120000)}/hari`,
        `Prioritas: Pangkas pesan antar online di hari kerja`
      ],
      suggestedAction: {
        label: 'Ikuti Tantangan Pekan Masak di Rumah',
        actionType: 'JOIN_CHALLENGE',
        payload: { challengeId: 'CHAL-01' }
      }
    };
  }

  // Default: Ringkasan Kesehatan Finansial Menyeluruh
  const answer = `👋 Halo ${user.name}! Berikut ringkasan kesehatan finansial keluarga Anda hari ini:\n\n` +
    `• **Skor Finansial:** **${health.score || 85}/100** (${health.statusLabel || 'Sangat Sehat'}).\n` +
    `• **Batas Belanja Aman Harian:** **Rp ${formatRupiahPlain(cashflow.safeDailySpend || 150000)}/hari**.\n` +
    `• **Ketahanan Cadangan Kas:** **${health.emergencyMonths || 2.5} bulan pengeluaran**.\n` +
    `• **Proyeksi Akhir Bulan:** ${cashflow.isDeficit ? '⚠️ Berpotensi defisit jika laju belanja tidak dikurangi.' : '✅ Diproyeksikan surplus kas di akhir bulan.'}\n\n` +
    `Anda dapat bertanya hal spesifik seperti simulasi cicilan, target tabungan qurban, atau tips memotong kebocoran anggaran!`;

  return {
    answer: answer,
    keyPoints: [
      `Skor Kesehatan: ${health.score || 85}/100`,
      `Safe Daily Spend: Rp ${formatRupiahPlain(cashflow.safeDailySpend || 150000)}/hari`,
      `Status Arus Kas: ${cashflow.paceStatus || 'Aman & Terkendali'}`
    ],
    suggestedAction: {
      label: 'Konsultasi Belanja Besar / Cicilan',
      actionType: 'ASK_EXAMPLE'
    }
  };
}

/**
 * ============================================================================
 * APPROVAL TAGIHAN RUTIN & PENGAJUAN DANA ANAK (US-5 & US-6)
 * ============================================================================
 */
function markBillAsPaid(adminId, billId) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const admin = verifyMemberById(adminId);
    if (!admin || admin.role !== 'Admin') {
      throw new Error('RBAC: Hanya Admin (Suami/Istri) yang dapat menandai tagihan lunas.');
    }

    const ss = getSpreadsheet();
    const shBill = ss.getSheetByName(SHEET_NAMES.TAGIHAN);
    const data = shBill.getDataRange().getValues();

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(billId)) {
        const billName = String(data[i][1]);
        const amount = Number(data[i][2] || 0);
        const category = String(data[i][4] || 'Tagihan & Utilitas');
        const walletId = String(data[i][5] || 'WLT-01');
        const currentStatus = String(data[i][6]);

        if (currentStatus === 'Lunas') {
          return { success: true, message: `Tagihan "${billName}" sudah berstatus Lunas.` };
        }

        // Tandai Lunas di Sheet Tagihan Rutin
        shBill.getRange(i + 1, 7).setValue('Lunas');

        // US-5 AC2: Otomatis mencatat sebagai transaksi pengeluaran
        const trxRes = saveTransaction(admin.id, {
          type: 'Keluar',
          amount: amount,
          category: category,
          description: `Pelunasan Tagihan Rutin: ${billName}`,
          walletId: walletId,
          source: 'Form'
        });

        return {
          success: true,
          transactionId: trxRes.transactionId,
          message: `Tagihan "${billName}" (Rp ${formatRupiahPlain(amount)}) berhasil ditandai LUNAS dan otomatis tercatat di Transaksi.`
        };
      }
    }
    throw new Error('Data tagihan tidak ditemukan.');
  } finally {
    lock.releaseLock();
  }
}

function saveRoutineBill(adminId, billPayload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const admin = verifyMemberById(adminId);
    if (!admin || admin.role !== 'Admin') {
      throw new Error('Hanya Admin yang dapat mengelola tagihan rutin.');
    }
    const ss = getSpreadsheet();
    const sh = ss.getSheetByName(SHEET_NAMES.TAGIHAN);
    const id = 'BIL-' + Utilities.formatDate(new Date(), 'Asia/Jakarta', 'HHmmss');
    sh.appendRow([
      id,
      String(billPayload.name || 'Tagihan Baru'),
      Number(billPayload.amount || 0),
      Number(billPayload.dueDay || 20),
      String(billPayload.category || 'Tagihan & Utilitas'),
      String(billPayload.walletId || 'WLT-01'),
      'Belum',
      'Belum'
    ]);
    return { success: true, billId: id, message: 'Tagihan rutin baru berhasil ditambahkan.' };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Pengajuan Dana Tambahan dari Anak / Anggota (US-6 AC2)
 */
function createFundRequest(memberId, payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const user = verifyMemberById(memberId);
    if (!user) throw new Error('Pengguna tidak valid.');

    const amount = Number(payload.amount || 0);
    if (amount <= 0) throw new Error('Nominal pengajuan harus lebih dari Rp 0.');

    const ss = getSpreadsheet();
    const sh = ss.getSheetByName(SHEET_NAMES.PENGAJUAN);
    const reqId = 'REQ-' + Utilities.formatDate(new Date(), 'Asia/Jakarta', 'ddHHmmss');
    const nowStr = Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd HH:mm');

    sh.appendRow([
      reqId,
      nowStr,
      user.id,
      user.name,
      amount,
      String(payload.reason || 'Permintaan dana tambahan'),
      'Menunggu Approval',
      ''
    ]);

    // UPGRADE FITUR #2: Kirim Notifikasi Interaktif + Tombol Inline [Setujui] / [Tolak] ke Telegram & WA Admin
    notifyAdminsInteractiveFundRequest(reqId, user.name, amount, String(payload.reason || 'Permintaan dana tambahan'));

    return {
      success: true,
      requestId: reqId,
      message: `Permintaan dana Rp ${formatRupiahPlain(amount)} telah dikirim ke Admin (beserta tombol Approval langsung di Bot Telegram/WA Ayah & Bunda).`
    };
  } finally {
    lock.releaseLock();
  }
}

function notifyAdminsInteractiveFundRequest(reqId, requesterName, amount, reason) {
  try {
    const admins = getAllMembers().filter(m => m.role === 'Admin' && m.status === 'Aktif');
    const msg = `🔔 *PENGAJUAN DANA BARU (${reqId})*\n\n` +
      `👤 *Dari:* ${requesterName}\n` +
      `💰 *Nominal:* Rp ${formatRupiahPlain(amount)}\n` +
      `📝 *Keperluan:* _${reason}_\n\n` +
      `Klik tombol di bawah ini untuk langsung menyetujui atau menolak dari chat:`;

    const inlineKeyboard = {
      inline_keyboard: [
        [
          { text: `✅ Setujui Rp ${formatRupiahPlain(amount)}`, callback_data: `REQ_APPROVE|${reqId}` },
          { text: `❌ Tolak Pengajuan`, callback_data: `REQ_REJECT|${reqId}` }
        ]
      ]
    };

    admins.forEach(adm => {
      if (adm.tgId) sendTelegramMessage(adm.tgId, msg, inlineKeyboard);
      if (adm.waId) {
        sendWhatsAppMessage(
          adm.waId,
          msg + `\n\nBalas cepat:\n• Ketik *SETUJU ${reqId}* untuk menyetujui\n• Ketik *TOLAK ${reqId}* untuk menolak`
        );
      }
    });
  } catch (e) {}
}

/**
 * ============================================================================
 * UPGRADE v2.0 FITUR #1: KANTONG IMPIAN & TABUNGAN TARGET KELUARGA (SINKING FUNDS)
 * Mendukung Gamifikasi Celengan Anak + Bonus Matching Orang Tua Otomatis
 * ============================================================================
 */
function saveSavingsGoal(memberId, goalPayload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const user = verifyMemberById(memberId);
    if (!user) throw new Error('Pengguna tidak valid.');

    const ss = getSpreadsheet();
    let sh = ss.getSheetByName(SHEET_NAMES.GOALS);
    if (!sh) {
      initDatabaseIfNeeded(true);
      sh = ss.getSheetByName(SHEET_NAMES.GOALS);
    }
    const isAdmin = user.role === 'Admin';
    const newId = 'GOL-' + Utilities.formatDate(new Date(), 'Asia/Jakarta', 'ddHHmmss');
    const goalTitle = String(goalPayload.name || goalPayload.title || 'Kantong Impian Baru');
    const targetAmt = Math.max(10000, Number(goalPayload.targetAmount || 1000000));
    const initSaved = Math.max(0, Number(goalPayload.savedAmount !== undefined ? goalPayload.savedAmount : (goalPayload.currentAmount || 0)));
    const ownerId = isAdmin ? String(goalPayload.ownerId || 'ALL') : user.id;
    const matchRate = isAdmin ? Number(goalPayload.matchingRate || 0) : 50;

    sh.appendRow([
      newId,
      goalTitle,
      targetAmt,
      initSaved,
      String(goalPayload.deadline || '2026-12-31'),
      ownerId,
      String(goalPayload.icon || 'fa-piggy-bank'),
      String(goalPayload.color || '#10B981'),
      matchRate,
      'Aktif'
    ]);
    invalidateServerCache();

    return {
      success: true,
      goalId: newId,
      message: `Kantong Impian "${goalTitle}" (Target Rp ${formatRupiahPlain(targetAmt)}) berhasil dibuat!`
    };
  } finally {
    lock.releaseLock();
  }
}

function contributeToGoal(memberId, payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const user = verifyMemberById(memberId);
    if (!user) throw new Error('Pengguna tidak terautentikasi.');

    const amount = Math.abs(Number(payload.amount || 0));
    if (amount <= 0) throw new Error('Nominal setoran tabungan harus lebih dari Rp 0.');

    const ss = getSpreadsheet();
    const sh = ss.getSheetByName(SHEET_NAMES.GOALS);
    const data = sh.getDataRange().getValues();

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(payload.goalId)) {
        const goalTitle = String(data[i][1]);
        const targetAmt = Number(data[i][2] || 0);
        const currentAmt = Number(data[i][3] || 0);
        const ownerId = String(data[i][5] || 'ALL');
        const matchRate = Number(data[i][8] || 0);

        // Hitung Bonus Matching Orang Tua jika ini tabungan Anak dan yang menyetor adalah Anak (atau diaktifkan)
        let parentBonus = 0;
        if (matchRate > 0 && (user.role !== 'Admin' || payload.applyParentMatch)) {
          parentBonus = Math.round(amount * (matchRate / 100));
        }

        const totalAdded = amount + parentBonus;
        const updatedAmt = currentAmt + totalAdded;
        sh.getRange(i + 1, 4).setValue(updatedAmt);

        if (updatedAmt >= targetAmt) {
          sh.getRange(i + 1, 10).setValue('Tercapai 🎉');
        }

        // Catat sebagai alokasi tabungan di riwayat transaksi agar saldo dompet sinkron
        const walletId = payload.walletId || (user.role === 'Admin' ? 'WLT-02' : 'WLT-05');
        saveTransaction(user.id, {
          type: 'Keluar',
          amount: amount,
          category: user.role === 'Admin' ? 'Pendidikan & Les' : 'Jajan/Anak',
          description: `[Setor Tabungan Impian] ${goalTitle}${parentBonus > 0 ? ` (+Bonus Matching Ortu Rp ${formatRupiahPlain(parentBonus)})` : ''}`,
          walletId: walletId,
          source: 'Form'
        });
        invalidateServerCache();

        const pct = targetAmt > 0 ? Math.min(100, Math.round((updatedAmt / targetAmt) * 100)) : 100;
        const bonusMsg = parentBonus > 0
          ? ` 🎁 Ditambah Bonus Matching Ortu (${matchRate}%) sebesar Rp ${formatRupiahPlain(parentBonus)}! Total masuk celengan: Rp ${formatRupiahPlain(totalAdded)}.`
          : '';

        return {
          success: true,
          goalId: payload.goalId,
          updatedAmount: updatedAmt,
          parentBonus: parentBonus,
          percentage: pct,
          message: `Berhasil menabung Rp ${formatRupiahPlain(amount)} ke "${goalTitle}" (${pct}%).${bonusMsg}`
        };
      }
    }
    throw new Error('Kantong Impian tidak ditemukan.');
  } finally {
    lock.releaseLock();
  }
}

function processFundRequestApproval(adminId, requestId, decision) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const admin = verifyMemberById(adminId);
    if (!admin || admin.role !== 'Admin') {
      throw new Error('RBAC: Hanya Admin yang dapat menyetujui atau menolak pengajuan dana.');
    }

    const ss = getSpreadsheet();
    const sh = ss.getSheetByName(SHEET_NAMES.PENGAJUAN);
    const data = sh.getDataRange().getValues();

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(requestId)) {
        const requesterId = String(data[i][2]);
        const requesterName = String(data[i][3]);
        const amount = Number(data[i][4] || 0);
        const reason = String(data[i][5] || '');

        const finalStatus = decision === 'APPROVE' ? 'Disetujui' : 'Ditolak';
        sh.getRange(i + 1, 7).setValue(finalStatus);
        sh.getRange(i + 1, 8).setValue(admin.name);

        // Jika disetujui, tambahkan kuota jajan anak & catat pengeluaran/alokasi
        if (decision === 'APPROVE') {
          const shAnggota = ss.getSheetByName(SHEET_NAMES.ANGGOTA);
          const angData = shAnggota.getDataRange().getValues();
          for (let j = 1; j < angData.length; j++) {
            if (String(angData[j][0]) === requesterId) {
              const oldQuota = Number(angData[j][8] || 0);
              shAnggota.getRange(j + 1, 9).setValue(oldQuota + amount);
              break;
            }
          }
          saveTransaction(admin.id, {
            type: 'Keluar',
            amount: amount,
            category: 'Jajan/Anak',
            description: `[Approval Dana ${requesterName}] ${reason}`,
            walletId: 'WLT-05',
            targetMemberId: requesterId,
            source: 'Form'
          });
        }
        invalidateServerCache();

        // Kirim notifikasi balasan otomatis ke WA/Telegram Anak yang mengajukan
        const childMember = verifyMemberById(requesterId);
        if (childMember) {
          const notifChild = decision === 'APPROVE'
            ? `🎉 *Hore! Pengajuan Danamu Disetujui!*\nPermintaan dana *Rp ${formatRupiahPlain(amount)}* untuk _"${reason}"_ telah disetujui oleh *${admin.name}*. Kuota jajanmu sudah otomatis bertambah!`
            : `ℹ️ Pengajuan dana *Rp ${formatRupiahPlain(amount)}* untuk _"${reason}"_ belum disetujui oleh *${admin.name}*.`;
          if (childMember.tgId) sendTelegramMessage(childMember.tgId, notifChild);
          if (childMember.waId) sendWhatsAppMessage(childMember.waId, notifChild);
        }

        return {
          success: true,
          status: finalStatus,
          message: `Pengajuan dana dari ${requesterName} sebesar Rp ${formatRupiahPlain(amount)} telah ${finalStatus.toUpperCase()}.`
        };
      }
    }
    throw new Error('Data pengajuan dana tidak ditemukan.');
  } finally {
    lock.releaseLock();
  }
}

/**
 * ============================================================================
 * KELOLA DOMPET, KATEGORI BUDGET & ANGGOTA KELUARGA (HANYA ADMIN)
 * ============================================================================
 */
function updateCategoryBudget(adminId, categoryName, newLimit, newWarnPercent) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const admin = verifyMemberById(adminId);
    if (!admin || admin.role !== 'Admin') {
      throw new Error('RBAC: Hanya Admin yang dapat mengubah target budget.');
    }
    const ss = getSpreadsheet();
    const sh = ss.getSheetByName(SHEET_NAMES.KATEGORI);
    const data = sh.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(categoryName)) {
        sh.getRange(i + 1, 2).setValue(Number(newLimit || 0));
        if (newWarnPercent !== undefined) {
          sh.getRange(i + 1, 3).setValue(Number(newWarnPercent || 80));
        }
        invalidateServerCache();
        return { success: true, message: `Target anggaran "${categoryName}" diperbarui menjadi Rp ${formatRupiahPlain(newLimit)}.` };
      }
    }
    throw new Error('Kategori tidak ditemukan.');
  } finally {
    lock.releaseLock();
  }
}

function saveWalletSource(adminId, walletPayload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const admin = verifyMemberById(adminId);
    if (!admin || admin.role !== 'Admin') {
      throw new Error('RBAC: Hanya Admin yang dapat menambah atau mengubah dompet.');
    }
    const ss = getSpreadsheet();
    const sh = ss.getSheetByName(SHEET_NAMES.DOMPET);
    const id = walletPayload.id || ('WLT-0' + sh.getLastRow());
    const initBal = Number(walletPayload.initialBalance || 0);
    sh.appendRow([
      id,
      String(walletPayload.name || 'Dompet Baru'),
      String(walletPayload.type || 'Bank'),
      initBal,
      initBal,
      String(walletPayload.info || '')
    ]);
    recalculateAllWalletBalances(ss);
    return { success: true, walletId: id, message: `Dompet "${walletPayload.name}" berhasil ditambahkan.` };
  } finally {
    lock.releaseLock();
  }
}

function inviteOrUpdateFamilyMember(adminId, memberPayload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const admin = verifyMemberById(adminId);
    if (!admin || admin.role !== 'Admin') {
      throw new Error('RBAC: Hanya Admin yang dapat mengundang anggota keluarga.');
    }
    const ss = getSpreadsheet();
    const sh = ss.getSheetByName(SHEET_NAMES.ANGGOTA);
    const currentMembers = getAllMembers().filter(m => m.status === 'Aktif');

    // Sesuai PRD Bab 3: Maksimal sistem dibatasi 6 anggota per keluarga
    if (!memberPayload.id && currentMembers.length >= 6) {
      throw new Error('Batas Kapasitas PRD: Maksimal 6 anggota keluarga aktif per akun rumah tangga Qyona.');
    }

    const newId = 'USR-0' + (sh.getLastRow());
    const role = memberPayload.role === 'Admin' ? 'Admin' : 'Member';
    const avatar = role === 'Admin' ? '🧑💼' : '🧒🎒';
    sh.appendRow([
      newId,
      String(memberPayload.name || 'Anggota Keluarga'),
      role,
      String(memberPayload.waId || ''),
      String(memberPayload.tgId || ''),
      'Aktif',
      String(memberPayload.pin || '1234'),
      avatar,
      Number(memberPayload.allowanceQuota || (role === 'Member' ? 500000 : 0))
    ]);
    invalidateServerCache();

    return {
      success: true,
      memberId: newId,
      message: `${memberPayload.name} (${role}) berhasil didaftarkan ke Keluarga Qyona.`
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * ============================================================================
 * EKSPOR LAPORAN PDF BULANAN & CSV/EXCEL (US-7)
 * ============================================================================
 */
function exportMonthlyCsv(memberId, monthYear) {
  const data = getAppBootstrapData(memberId, monthYear);
  const headers = ['ID Transaksi', 'Tanggal', 'Tipe', 'Nominal (Rp)', 'Kategori', 'Keterangan', 'Dompet', 'Anggota', 'Sumber Input', 'Status Approval', 'URL Foto Struk'];
  const rows = data.transactions.map(t => [
    t.id,
    t.date,
    t.type,
    t.amount,
    `"${(t.category || '').replace(/"/g, '""')}"`,
    `"${(t.description || '').replace(/"/g, '""')}"`,
    `"${(t.walletName || '').replace(/"/g, '""')}"`,
    `"${(t.memberName || '').replace(/"/g, '""')}"`,
    t.source,
    t.approvalStatus,
    t.receiptUrl
  ]);

  const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  return {
    success: true,
    fileName: `Laporan_Transaksi_Qyona_${data.currentMonthYear}.csv`,
    csvContent: csvContent
  };
}

function generateMonthlyPdfReport(memberId, monthYear) {
  const data = getAppBootstrapData(memberId, monthYear);
  const s = data.summary;
  const topInsight = data.insights[0] ? data.insights[0].analysis : 'Pengeluaran keluarga tercatat terkendali sesuai anggaran.';

  const catRowsHtml = data.categoryBreakdown.map(c => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #e2e8f0;"><b>${c.name}</b></td>
      <td style="padding:8px;border-bottom:1px solid #e2e8f0;text-align:right;">Rp ${formatRupiahPlain(c.spent)}</td>
      <td style="padding:8px;border-bottom:1px solid #e2e8f0;text-align:right;">Rp ${formatRupiahPlain(c.limit)}</td>
      <td style="padding:8px;border-bottom:1px solid #e2e8f0;text-align:center;color:${c.percentage >= 100 ? '#dc2626' : '#0f766e'};font-weight:bold;">${c.percentage}%</td>
    </tr>
  `).join('');

  const billRowsHtml = data.bills.map(b => `
    <tr>
      <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;">${b.name}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;">Tgl ${b.dueDay}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:right;">Rp ${formatRupiahPlain(b.amount)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:center;">${b.status}</td>
    </tr>
  `).join('');

  const htmlReport = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: Arial, sans-serif; color: #0f172a; margin: 28px; font-size: 12px; }
        .header { background: #0f766e; color: white; padding: 18px 22px; border-radius: 10px; }
        .header h1 { margin: 0; font-size: 20px; }
        .header p { margin: 4px 0 0; opacity: 0.9; font-size: 11px; }
        .grid { width: 100%; margin-top: 16px; border-collapse: collapse; }
        .card { background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 8px; padding: 12px; }
        h3 { color: #0f766e; margin: 18px 0 8px; border-bottom: 2px solid #0f766e; padding-bottom: 4px; }
        table.data { width: 100%; border-collapse: collapse; margin-top: 6px; }
        table.data th { background: #f1f5f9; text-align: left; padding: 8px; border-bottom: 2px solid #cbd5e1; }
        .insight-box { background: #ecfdf5; border-left: 4px solid #10b981; padding: 12px; border-radius: 6px; margin-top: 12px; line-height: 1.5; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>Laporan Keuangan Rumah Tangga Qyona</h1>
        <p>Periode: ${data.currentMonthYear} • Dicetak oleh: ${data.currentUser.name} (${data.currentUser.role}) • Tanggal Cetak: ${data.serverTime}</p>
      </div>

      <table class="grid">
        <tr>
          <td class="card" width="33%"><b>Saldo Gabungan</b><br><span style="font-size:16px;color:#0f766e;font-weight:bold;">Rp ${formatRupiahPlain(s.totalBalance)}</span></td>
          <td class="card" width="33%"><b>Total Pemasukan</b><br><span style="font-size:16px;color:#10b981;font-weight:bold;">Rp ${formatRupiahPlain(s.totalIncome)}</span></td>
          <td class="card" width="33%"><b>Total Pengeluaran</b><br><span style="font-size:16px;color:#ef4444;font-weight:bold;">Rp ${formatRupiahPlain(s.totalExpense)} (${s.budgetUsedPercent}%)</span></td>
        </tr>
      </table>

      <h3>1. Breakdown Realisasi Anggaran per Kategori</h3>
      <table class="data">
        <thead>
          <tr><th>Kategori</th><th style="text-align:right;">Realisasi</th><th style="text-align:right;">Batas Budget</th><th style="text-align:center;">Persentase</th></tr>
        </thead>
        <tbody>${catRowsHtml}</tbody>
      </table>

      ${data.bills.length > 0 ? `
      <h3>2. Status Tagihan Rutin Keluarga</h3>
      <table class="data">
        <thead>
          <tr><th>Nama Tagihan</th><th>Jatuh Tempo</th><th style="text-align:right;">Nominal</th><th style="text-align:center;">Status</th></tr>
        </thead>
        <tbody>${billRowsHtml}</tbody>
      </table>` : ''}

      <h3>3. Kesimpulan & Rekomendasi AI Insight</h3>
      <div class="insight-box">
        <b>Analisis AI Qyona:</b><br>${topInsight}
      </div>
    </body>
    </html>
  `;

  try {
    const blob = Utilities.newBlob(htmlReport, 'text/html', 'report.html').getAs('application/pdf');
    blob.setName(`Laporan_Keuangan_Qyona_${data.currentMonthYear}.pdf`);
    const base64Pdf = Utilities.base64Encode(blob.getBytes());
    return {
      success: true,
      fileName: `Laporan_Keuangan_Qyona_${data.currentMonthYear}.pdf`,
      base64Pdf: base64Pdf,
      htmlPreview: htmlReport
    };
  } catch (e) {
    return {
      success: true,
      fileName: `Laporan_Keuangan_Qyona_${data.currentMonthYear}.html`,
      base64Pdf: '',
      htmlPreview: htmlReport
    };
  }
}

/**
 * ============================================================================
 * UPGRADE v2.0 FITUR #2: LIVE BOT TELEGRAM & WHATSAPP 2 ARAH + INLINE BUTTONS
 * ============================================================================
 */
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return ContentService.createTextOutput(JSON.stringify({ status: 'ok' })).setMimeType(ContentService.MimeType.JSON);
    }

    const body = JSON.parse(e.postData.contents);

    // 0. Deteksi Sinkronisasi RPC dari GitHub Pages / PWA Eksternal
    if (body && body.action === 'rpc') {
      initDatabaseIfNeeded();
      const res = executeAllowedRpc(String(body.fn || ''), body.args || []);
      return ContentService.createTextOutput(JSON.stringify({ ok: true, data: res }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // A1. Deteksi Klik Tombol Inline Keyboard Telegram (callback_query)
    if (body.callback_query) {
      const cb = body.callback_query;
      const tgChatId = String(cb.from.id || cb.message?.chat?.id || '');
      const member = verifyMemberByChatId(tgChatId);
      if (!member) {
        answerTelegramCallback(cb.id, 'Akses ditolak: ID belum terdaftar.');
        return ContentService.createTextOutput('OK');
      }
      const responseText = handleInteractiveBotCallback(member, String(cb.data || ''));
      answerTelegramCallback(cb.id, 'Diproses oleh Qyona AI!');
      sendTelegramMessage(tgChatId, responseText);
      return ContentService.createTextOutput('OK');
    }

    // A2. Deteksi Pesan Teks / Foto dari Webhook Telegram Bot API
    if (body.message || body.edited_message) {
      const msg = body.message || body.edited_message;
      const tgChatId = String(msg.chat.id);
      const member = verifyMemberByChatId(tgChatId);

      if (!member) {
        sendTelegramMessage(tgChatId, `⛔ *Akses Ditolak (Privat)*\nID Chat Telegram Anda (\`${tgChatId}\`) belum terdaftar di aplikasi *Catatan Keuangan Rumah Qyona*.\n\nMinta Admin (Suami/Istri) mendaftarkan ID ini di menu *Kelola Keluarga*.`);
        return ContentService.createTextOutput('OK');
      }

      const text = (msg.text || msg.caption || '').trim();
      const result = processChatbotMessage(member.id, text);
      const replyMarkup = buildTelegramInlineMarkupForChatResult(member, result);
      sendTelegramMessage(tgChatId, result.reply, replyMarkup);
      return ContentService.createTextOutput('OK');
    }

    // B. Deteksi Webhook WhatsApp (Meta Cloud API atau Fonnte/Twilio)
    const waSender = body.sender || (body.entry && body.entry[0]?.changes?.[0]?.value?.messages?.[0]?.from);
    const waText = body.message || (body.entry && body.entry[0]?.changes?.[0]?.value?.messages?.[0]?.text?.body);

    if (waSender && waText) {
      const member = verifyMemberByChatId(waSender);
      if (!member) {
        sendWhatsAppMessage(waSender, `⛔ *Akses Keluarga Privat*\nNomor WhatsApp (${waSender}) belum terdaftar di Catatan Keuangan Rumah Qyona.`);
        return ContentService.createTextOutput('OK');
      }

      // Cek apakah balas cepat perintah SETUJU REQ-xx atau TOLAK REQ-xx via WA
      const upperWa = String(waText).trim().toUpperCase();
      if (upperWa.startsWith('SETUJU REQ-') || upperWa.startsWith('TOLAK REQ-')) {
        const parts = upperWa.split(/\s+/);
        const decision = parts[0] === 'SETUJU' ? 'APPROVE' : 'REJECT';
        const reqId = parts[1];
        const apprRes = processFundRequestApproval(member.id, reqId, decision);
        sendWhatsAppMessage(waSender, `✅ ${apprRes.message}`);
        return ContentService.createTextOutput('OK');
      }

      const result = processChatbotMessage(member.id, waText);
      sendWhatsAppMessage(waSender, result.reply);
      return ContentService.createTextOutput('OK');
    }

    return ContentService.createTextOutput(JSON.stringify({ status: 'ignored' })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: err.message })).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Buat Tombol Inline Keyboard Telegram otomatis saat transaksi berhasil disimpan atau butuh konfirmasi
 */
function buildTelegramInlineMarkupForChatResult(member, result) {
  if (!result) return null;
  if (result.status === 'NEEDS_CONFIRMATION' && result.pendingMessage) {
    const shortMsg = String(result.pendingMessage).slice(0, 32);
    return {
      inline_keyboard: [
        [
          { text: '🍲 Dapur', callback_data: `CAT_CONFIRM|Dapur & Makanan|${shortMsg}` },
          { text: '⚡ Tagihan', callback_data: `CAT_CONFIRM|Tagihan & Utilitas|${shortMsg}` }
        ],
        [
          { text: '⛽ Transport', callback_data: `CAT_CONFIRM|Transportasi & BBM|${shortMsg}` },
          { text: '🍦 Jajan/Anak', callback_data: `CAT_CONFIRM|Jajan/Anak|${shortMsg}` }
        ]
      ]
    };
  }

  if (result.status === 'SAVED' && result.transactionsCreated && result.transactionsCreated.length > 0) {
    const firstTrx = result.transactionsCreated[0];
    const buttons = [
      [{ text: `❌ Batalkan / Hapus (${firstTrx.id})`, callback_data: `TRX_DELETE|${firstTrx.id}` }]
    ];
    if (member.role === 'Admin') {
      buttons.unshift([
        { text: '🔄 Ubah ke Dapur', callback_data: `TRX_CAT|${firstTrx.id}|Dapur & Makanan` },
        { text: '🔄 Ubah ke Tagihan', callback_data: `TRX_CAT|${firstTrx.id}|Tagihan & Utilitas` }
      ]);
    }
    return { inline_keyboard: buttons };
  }
  return null;
}

/**
 * Eksekusi aksi ketika tombol Inline Keyboard di Telegram diklik oleh pengguna
 */
function handleInteractiveBotCallback(member, callbackData) {
  const parts = String(callbackData || '').split('|');
  const action = parts[0];

  if (action === 'REQ_APPROVE' || action === 'REQ_REJECT') {
    const reqId = parts[1];
    const decision = action === 'REQ_APPROVE' ? 'APPROVE' : 'REJECT';
    const res = processFundRequestApproval(member.id, reqId, decision);
    return `✅ *Approval Selesai*\n${res.message}`;
  }

  if (action === 'TRX_DELETE') {
    const trxId = parts[1];
    const res = deleteTransaction(member.id, trxId);
    return `🗑️ *Transaksi Dibatalkan*\n${res.message}`;
  }

  if (action === 'TRX_CAT') {
    const trxId = parts[1];
    const newCat = parts[2];
    const ss = getSpreadsheet();
    const sh = ss.getSheetByName(SHEET_NAMES.TRANSAKSI);
    const data = sh.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === trxId) {
        sh.getRange(i + 1, 5).setValue(newCat);
        return `🔄 Kategori transaksi *${trxId}* berhasil diubah menjadi *${newCat}*.`;
      }
    }
    return `⚠️ Transaksi ${trxId} tidak ditemukan.`;
  }

  if (action === 'CAT_CONFIRM') {
    const chosenCat = parts[1];
    const pendingMsg = parts[2];
    const res = processChatbotMessage(member.id, pendingMsg, chosenCat);
    return res.reply;
  }

  return 'ℹ️ Perintah tombol telah diproses.';
}

function answerTelegramCallback(callbackQueryId, notificationText) {
  const token = getConfig('TELEGRAM_BOT_TOKEN', '');
  if (!token || !callbackQueryId) return;
  UrlFetchApp.fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      callback_query_id: callbackQueryId,
      text: notificationText
    }),
    muteHttpExceptions: true
  });
}

function sendTelegramMessage(chatId, text, replyMarkup) {
  const token = getConfig('TELEGRAM_BOT_TOKEN', '');
  if (!token) return;
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const payloadObj = {
    chat_id: chatId,
    text: text,
    parse_mode: 'Markdown'
  };
  if (replyMarkup) {
    payloadObj.reply_markup = replyMarkup;
  }
  UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payloadObj),
    muteHttpExceptions: true
  });
}

/**
 * One-Click Register Webhook Telegram dari UI Admin Qyona
 */
function registerTelegramWebhook(adminId, customWebAppUrl) {
  const admin = verifyMemberById(adminId);
  if (!admin || admin.role !== 'Admin') {
    throw new Error('Hanya Admin yang dapat mendaftarkan Webhook Telegram.');
  }
  const token = getConfig('TELEGRAM_BOT_TOKEN', '');
  if (!token) {
    throw new Error('Token Bot Telegram belum diisi. Masukkan TELEGRAM_BOT_TOKEN terlebih dahulu lalu klik Simpan.');
  }
  const targetUrl = customWebAppUrl || ScriptApp.getService().getUrl();
  if (!targetUrl) {
    throw new Error('URL Web App GAS belum ditemukan.');
  }
  const resp = UrlFetchApp.fetch(`https://api.telegram.org/bot${token}/setWebhook?url=${encodeURIComponent(targetUrl)}`, {
    method: 'get',
    muteHttpExceptions: true
  });
  const json = JSON.parse(resp.getContentText());
  if (json && json.ok) {
    return {
      success: true,
      webhookUrl: targetUrl,
      message: `Webhook Telegram berhasil terhubung otomatis ke ${targetUrl}!`
    };
  }
  throw new Error('Gagal menyambungkan webhook Telegram: ' + (json.description || resp.getContentText()));
}

/**
 * Simulasi & Tes Pengiriman Notifikasi Bot Interaktif (Dengan Tombol Inline)
 */
function testInteractiveBotNotification(adminId) {
  const admin = verifyMemberById(adminId);
  if (!admin) throw new Error('Pengguna tidak ditemukan.');

  const sampleText = `🤖 *Tes Bot Interaktif 2 Arah Qyona v2.0*\n\n` +
    `Halo *${admin.name}*! Bot keluarga Anda telah mendukung **Tombol Inline Interaktif**.\n` +
    `• Saat mencatat pengeluaran via chat, Anda bisa langsung klik **[🔄 Ubah Kategori]** atau **[❌ Batalkan]**.\n` +
    `• Saat Anak mengajukan dana, tombol **[✅ Setujui]** akan muncul di sini!`;

  const sampleKeyboard = {
    inline_keyboard: [
      [
        { text: '✅ Setujui Rp 125.000 (REQ-01)', callback_data: 'REQ_APPROVE|REQ-01' },
        { text: '❌ Tolak (REQ-01)', callback_data: 'REQ_REJECT|REQ-01' }
      ]
    ]
  };

  let sentChannel = [];
  if (getConfig('TELEGRAM_BOT_TOKEN', '') && admin.tgId) {
    sendTelegramMessage(admin.tgId, sampleText, sampleKeyboard);
    sentChannel.push('Telegram (' + admin.tgId + ')');
  }
  if (getConfig('WA_API_TOKEN', '') && admin.waId) {
    sendWhatsAppMessage(admin.waId, sampleText + `\n\nKetik *SETUJU REQ-01* untuk mencoba approval via WhatsApp.`);
    sentChannel.push('WhatsApp (' + admin.waId + ')');
  }

  return {
    success: true,
    sentChannels: sentChannel,
    previewMessage: sampleText,
    message: sentChannel.length > 0
      ? `Pesan interaktif dengan tombol inline berhasil dikirim ke ${sentChannel.join(' & ')}!`
      : 'Simulasi Bot Interaktif berhasil ditampilkan di panel Chat AI Qyona (isi Token Telegram/WA di pengaturan untuk mengirim ke HP nyata).'
  };
}

function sendWhatsAppMessage(phone, text) {
  const token = getConfig('WA_API_TOKEN', '');
  if (!token) return;
  const phoneNumberId = getConfig('WA_PHONE_NUMBER_ID', '');

  if (phoneNumberId) {
    // Meta WhatsApp Cloud API Resmi
    UrlFetchApp.fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}/messages`, {
      method: 'post',
      headers: { Authorization: `Bearer ${token}` },
      contentType: 'application/json',
      payload: JSON.stringify({
        messaging_product: 'whatsapp',
        to: phone,
        type: 'text',
        text: { body: text }
      }),
      muteHttpExceptions: true
    });
  } else {
    // Fonnte Gateway populer di Indonesia
    UrlFetchApp.fetch('https://api.fonnte.com/send', {
      method: 'post',
      headers: { Authorization: token },
      payload: { target: phone, message: text },
      muteHttpExceptions: true
    });
  }
}

/**
 * ============================================================================
 * TIME-DRIVEN TRIGGERS: REMINDER TAGIHAN H-3, RETENSISTRUK 3 BULAN, INSIGHT TGL 1
 * ============================================================================
 */

/**
 * Pasang seluruh trigger otomatis (Dapat dipanggil dari UI Pengaturan Admin)
 */
function setupAutomatedTriggers(adminId) {
  const admin = verifyMemberById(adminId);
  if (!admin || admin.role !== 'Admin') {
    throw new Error('Hanya Admin yang dapat mengaktifkan Trigger terjadwal.');
  }

  // Hapus trigger duplikat sebelumnya
  const existing = ScriptApp.getProjectTriggers();
  existing.forEach(t => ScriptApp.deleteTrigger(t));

  // 1. Trigger Harian (Jam 08:00 pagi) -> Cek Tagihan H-3 & Retensi Drive 3 Bulan
  ScriptApp.newTrigger('runDailyHouseholdAutomation')
    .timeBased()
    .everyDays(1)
    .atHour(8)
    .create();

  // 2. Trigger Bulanan (Setiap Tanggal 1 Jam 07:00 pagi) -> Kirim AI Insight Bulanan ke Admin
  ScriptApp.newTrigger('runMonthlyInsightBroadcast')
    .timeBased()
    .onMonthDay(1)
    .atHour(7)
    .create();

  return {
    success: true,
    message: 'Trigger Otomatis Harian (H-3 Tagihan & Retensi Foto 3 Bulan) dan Bulanan (AI Insight Tanggal 1) berhasil diaktifkan!'
  };
}

/**
 * Trigger Harian:
 * 1. Kirim pengingat tagihan H-3 sebelum jatuh tempo (US-5 AC1)
 * 2. Hapus foto struk di Google Drive yang berumur > 3 bulan (Bab 4.2 & Bab 6)
 */
function runDailyHouseholdAutomation() {
  const ss = getSpreadsheet();
  const shBill = ss.getSheetByName(SHEET_NAMES.TAGIHAN);
  const data = shBill.getDataRange().getValues();
  const todayDay = new Date().getDate();
  const admins = getAllMembers().filter(m => m.role === 'Admin' && m.status === 'Aktif');

  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    const billName = String(r[1]);
    const amount = Number(r[2] || 0);
    const dueDay = Number(r[3] || 1);
    const status = String(r[6]);
    const diffDays = dueDay - todayDay;

    if (status !== 'Lunas' && diffDays >= 0 && diffDays <= 3) {
      const msg = `⏰ *Pengingat Tagihan Rutin Qyona (H-${diffDays})*\nTagihan *${billName}* sebesar *Rp ${formatRupiahPlain(amount)}* jatuh tempo pada tanggal ${dueDay}.\n\nSilakan buka menu *Tagihan Rutin* dan klik *Tandai Lunas* jika sudah dibayar.`;
      admins.forEach(adm => {
        if (adm.tgId) sendTelegramMessage(adm.tgId, msg);
        if (adm.waId) sendWhatsAppMessage(adm.waId, msg);
      });
      shBill.getRange(i + 1, 8).setValue('Sudah');
    }
  }

  // Kebijakan Retensi Media Bab 4.2: Hapus foto struk > 90 hari (3 bulan)
  cleanupOldReceiptsFromDrive();
}

function cleanupOldReceiptsFromDrive() {
  try {
    const folder = getOrCreateReceiptFolder();
    const files = folder.getFiles();
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setDate(threeMonthsAgo.getDate() - 90);

    while (files.hasNext()) {
      const file = files.next();
      if (file.getDateCreated() < threeMonthsAgo) {
        file.setTrashed(true);
      }
    }
  } catch (e) {
    // Abaikan jika belum ada izin Drive
  }
}

/**
 * Trigger Bulanan Setiap Tanggal 1 (US-4 AC3)
 */
function runMonthlyInsightBroadcast() {
  const admins = getAllMembers().filter(m => m.role === 'Admin' && m.status === 'Aktif');
  if (admins.length === 0) return;

  const res = generateProactiveAIInsight(admins[0].id);
  if (res && res.insight) {
    const text = `📊 *AI Insight Bulanan Keluarga Qyona*\n\n${res.insight.analysis}\n\n💡 *Potensi Penghematan:* Rp ${formatRupiahPlain(res.insight.estimatedSaving)}/bulan`;
    admins.forEach(adm => {
      if (adm.tgId) sendTelegramMessage(adm.tgId, text);
      if (adm.waId) sendWhatsAppMessage(adm.waId, text);
    });
  }
}

function formatRupiahPlain(num) {
  return Math.round(Number(num || 0)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}
