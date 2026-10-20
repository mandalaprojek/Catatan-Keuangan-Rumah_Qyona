# 🏡 Qyona — Catatan Keuangan Rumah Tangga Modern

[![Google Apps Script](https://img.shields.io/badge/Google%20Apps%20Script-4285F4?style=for-the-badge&logo=google&logoColor=white)](https://developers.google.com/apps-script)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)
[![Chart.js](https://img.shields.io/badge/Chart.js-FF6384?style=for-the-badge&logo=chartdotjs&logoColor=white)](https://www.chartjs.org/)
[![PWA Ready](https://img.shields.io/badge/PWA-Ready-10b981?style=for-the-badge&logo=pwa&logoColor=white)](https://web.dev/progressive-web-apps/)
[![Gemini AI](https://img.shields.io/badge/Google%20Gemini-8E75C2?style=for-the-badge&logo=googlegemini&logoColor=white)](https://ai.google.dev/)

**Qyona** adalah aplikasi pencatatan dan tata kelola keuangan rumah tangga terpusat, ditenagai oleh **Google Sheets** sebagai database gratis dan andal, serta diperkuat oleh **Google Apps Script** dan **AI Cerdas Qyona** untuk otomatisasi cerdas, deteksi kebocoran anggaran, dan pemantauan arus kas keluarga.

---

## 🌟 Fitur Unggulan

### 1. 🧠 Asisten AI Percakapan & Stream Parser Canggih
* **Continuous Natural Stream Parser (Tanpa Tanda Pemisah):**
  Anda dapat mengetik belanjaan beruntun dengan bahasa santai sehari-hari tanpa tanda koma atau titik. AI otomatis mengenali nominal harga sebagai pemisah item.
  > Contoh: *"Tadi pagi beli beras 5kg 50rb dan sayur bayam 10rb pakai tunai terus isi bensin motor 200rb pakai gopay"*
* **Backward Wallet Inheritance:**
  Metode bayar yang disebutkan di akhir klausa otomatis diwariskan ke belanjaan sebelumnya dalam kelompok yang sama (misal: beras & sayur bayam sama-sama masuk ke Dompet Tunai Dapur).
* **Kalkulasi Perkalian Otomatis (`@` / `x`):**
  Mengenali pola kuantitas seperti `ayam 2 ekor @35rb` (Rp 70.000) atau `3x 15.000` (Rp 45.000).
* **Auto-Create Kategori & Kamus Kata Kunci:**
  Membuat kategori baru secara otomatis saat belum ada di database, serta mempelajari kebiasaan belanja ke lembar kamus AI.
* **Perintah Aksi Instan (One-Click / Text Action):**
  - Bayar tagihan: *"Bayar lunas WiFi Biznet"*
  - Atur anggaran: *"Ubah budget Dapur jadi 4 juta"*
  - Menabung target: *"Tabung 250rb ke Liburan Bali"*

---

### 2. 🛡️ Audit Trail Transaksi (Soft-Delete & Auto-Refund)
* Setiap transaksi yang dihapus atau dibatalkan (via Undo Chat maupun Dashboard) **tidak dihapus permanen** dari Google Sheets, melainkan diberi status **`'Dibatalkan'`**.
* **Auto-Refund:** Saldo dompet otomatis dikembalikan seketika, dan nilai transaksi batal dikecualikan dari total pengeluaran bulanan.
* **Tanda Visual Jelas:** Transaksi batal tetap tercatat di riwayat dengan coretan teks (*strikethrough*), badge `[Dibatalkan]`, dan tombol edit dinonaktifkan.

---

### 3. 📊 AI Insight Finansial Keluarga
* **Family Financial Health Score (0–100):** Penilaian kesehatan keuangan berdasarkan 4 pilar (Ketahanan Kas Darurat, Kedisiplinan Budget, Rasio Menabung, dan Pengendalian Kebocoran).
* **Deteksi Kebocoran Halus (Micro-Leakage Detector):** Mengendus pengeluaran kecil berulang seperti kopi susu, jajan minimarket impulsif, ongkos pesan antar online, dan biaya admin transfer.
* **Batas Belanja Harian Aman (Safe Daily Spend & Burn Rate):** Menghitung batas uang belanja harian yang aman agar anggaran tidak habis sebelum akhir bulan.
* **Tantangan Menabung 7 Hari (Gamified Challenges):** Misi penghematan mingguan interaktif untuk keluarga dan anak.
* **Tanya Penasihat Finansial AI:** Chat langsung untuk konsultasi alokasi dana, simulasi cicilan, dan strategi tabungan.

---

### 4. 👨‍👩‍👧‍👦 Kontrol Akses Berbasis Peran (RBAC)
* **Admin (Ayah & Bunda):**
  - Akses penuh seluruh dompet (BCA, Mandiri, GoPay, Tunai Dapur).
  - Mengelola kategori & batas anggaran bulanan.
  - Menyetujui/menolak pengajuan dana dan transaksi anak.
  - Kelola tagihan rutin dan target tabungan bersama.
* **Member Terbatas (Anak — Kakak Raka & Adik Nayla):**
  - Tampilan khusus kuota uang jajan harian/bulanan.
  - Kategori otomatis terkunci pada `Jajan/Anak`.
  - Formulir pengajuan dana saku tambahan ke orang tua.

---

### 5. 📸 OCR Struk Belanja & Cloud Backup
* Pindai foto struk belanjaan fisik secara instan.
* Gambar struk otomatis disimpan rapi ke folder Google Drive `Qyona_Struk_Belanja` dan ditautkan langsung ke baris transaksi terkait.

---

### 6. 🔄 Sinkronisasi Real-Time & PWA Standalone
* Tombol sinkronisasi sekali sentuh di header dengan animasi putar instan dan bypass server cache.
* Dukungan API dua arah `doGet` dan `doPost` JSON-RPC untuk integrasi dengan GitHub Pages dan aplikasi mandiri.
* Siap dipasang di layar utama ponsel Android & iOS (*Add to Home Screen*) dengan safe-area notch / Dynamic Island.

---

## 📁 Struktur Berkas

```
.
├── Code.gs             # Backend Google Apps Script (Engine Database, AI Chatbot, RPC API)
├── index.html          # Frontend Utama (Single-File Web App & GitHub Pages PWA Interface)
├── JavaScript.html     # Frontend Controller, Event Handlers, Chart.js & Local Emulator
├── Stylesheet.html     # Custom Theme, Animasi, Glassmorphism & Safe Area CSS
├── appsscript.json     # Konfigurasi Manifest Google Apps Script (OAuth Scopes, V8 Engine)
├── manifest.json       # Web App Manifest untuk instalasi PWA
├── sw.js               # Service Worker untuk caching offline ringan
├── .nojekyll           # Mencegah GitHub Pages memproses Jekyll (menghindari error 404)
├── 404.html            # Redirect fallback GitHub Pages ke root index.html
├── .clasp.json         # Konfigurasi Google Clasp untuk sinkronisasi repository
└── README.md           # Dokumentasi resmi proyek
```

---

## 🚀 Panduan Instalasi & Deployment

### Cara 1: Akses Langsung via GitHub Pages (PWA Instant)

1. Buka repositori Anda di GitHub: `https://github.com/mandalaprojek/Catatan-Keuangan-Rumah_Qyona`.
2. Klik tab **Settings** > menu sebelah kiri pilih **Pages**.
3. Pada bagian **Build and deployment**:
   * **Source**: Pilih `Deploy from a branch`
   * **Branch**: Pilih `main` dan folder `/(root)`
   * Klik **Save**.
4. Tunggu 1–2 menit, tautan website Anda akan aktif di:
   👉 **`https://mandalaprojek.github.io/Catatan-Keuangan-Rumah_Qyona/`**

---

### Cara 2: Menghubungkan ke Google Spreadsheet & Apps Script (Database Pribadi)

1. **Buka Google Spreadsheet baru:**
   Beri nama spreadsheet Anda, misalnya `Database Qyona Keuangan`.
2. **Buka Apps Script:**
   Klik menu **Ekstensi (Extensions)** > **Apps Script**.
3. **Buat berkas-berkas berikut di editor Apps Script:**
   * `Code.gs` ➔ Salin seluruh isi berkas `Code.gs`.
   * `index.html` ➔ Salin seluruh isi berkas `index.html`.
   * `JavaScript.html` ➔ Salin seluruh isi berkas `JavaScript.html`.
   * `Stylesheet.html` ➔ Salin seluruh isi berkas `Stylesheet.html`.
   * `appsscript.json` ➔ Klik ikon roda gigi (Project Settings) > centang *Show "appsscript.json" manifest file in editor*, lalu salin isi berkas `appsscript.json`.
4. **Deploy Web App:**
   * Klik tombol **Deploy** di kanan atas > **New deployment**.
   * Pilih tipe: **Web app**.
   * Isi konfigurasi:
     - **Execute as:** `Me (email Anda)`
     - **Who has access:** `Anyone` (atau `Anyone with Google account`)
   * Klik **Deploy**, lalu salin URL Web App yang dihasilkan.

---

### Cara 3: Menggunakan Google Clasp (Untuk Developer)

1. **Clone repository ini:**
   ```bash
   git clone https://github.com/mandalaprojek/Catatan-Keuangan-Rumah_Qyona.git
   cd Catatan-Keuangan-Rumah_Qyona
   ```
2. **Login ke Google Apps Script CLI (clasp):**
   ```bash
   npx @google/clasp login
   ```
3. **Hubungkan ke Google Script ID Anda:**
   Buka file `.clasp.json` dan pastikan `scriptId` sudah terisi dengan ID Google Apps Script Spreadsheet Anda:
   ```json
   {
     "scriptId": "ID_GOOGLE_SCRIPT_ANDA",
     "rootDir": "."
   }
   ```
4. **Push kode ke Google Apps Script:**
   ```bash
   npx @google/clasp push --force
   ```

---

## ⚙️ Konfigurasi Script Properties (Opsional)

Untuk mengaktifkan fitur cerdas Gemini AI, Telegram Bot, dan WhatsApp, buka **Project Settings** > **Script Properties** di Apps Script editor, lalu tambahkan:

| Property Key | Deskripsi | Default / Contoh |
|---|---|---|
| `FAMILY_INVITE_CODE` | Kode PIN undangan untuk keluarga baru | `QYONA-2026` |
| `GEMINI_API_KEY` | API Key Google Gemini (Vision & Advisor) | *(Dari Google AI Studio)* |
| `DRIVE_FOLDER_ID` | ID Folder Google Drive simpanan struk | *(Auto-created)* |
| `TELEGRAM_BOT_TOKEN`| Token bot dari BotFather untuk notifikasi | *(Opsional)* |
| `WA_API_TOKEN` | Token WhatsApp Gateway (Fonnte / Cloud API)| *(Opsional)* |

---

## 📱 Cara Akses & Login

Aplikasi menyertakan akun simulasi instan untuk seluruh anggota keluarga:

| Nama Anggota | Peran | Akses Fitur | PIN Bawaan |
|---|---|---|:---:|
| **Ayah Dimas** | Admin | Akses Penuh Seluruh Dompet, Laporan, & Approval | `1234` |
| **Bunda Sarah** | Admin | Akses Penuh Seluruh Dompet, Laporan, & Approval | `1234` |
| **Kakak Raka** | Member (Anak) | Khusus Kuota Uang Jajan, Tabungan, & Minta Dana | `1234` |
| **Adik Nayla** | Member (Anak) | Khusus Kuota Uang Jajan, Tabungan, & Minta Dana | `1234` |

---

## 💡 Contoh Interaksi Chat AI

Ketik atau rekam suara Anda di panel Asisten AI Qyona:

* **Belanja Borongan:**
  > *"Beli beras 5kg 50rb sayur bayam 10rb telur 30rb pakai tunai terus isi bensin mobil 200rb via gopay"*
* **Perkalian Item:**
  > *"Tadi beli ayam 2 ekor @35rb sama sosis 3 pak @15rb pakai bca"*
* **Tanya Keuangan:**
  > *"Sisa uang makan bulan ini berapa?"*
  > *"Total saldo keluarga sekarang berapa?"*
* **Aksi Cepat:**
  > *"Bayar lunas tagihan WiFi"*
  > *"Tabung 100rb ke Kantong Impian Laptop"*
* **Minta Dana (Akun Anak):**
  > *"Minta uang saku tambahan 50rb buat beli buku les"*

---

## 📄 Lisensi

Didistribusikan di bawah lisensi MIT. Silakan gunakan, modifikasi, dan kembangkan untuk kebutuhan tata kelola finansial rumah tangga Anda.

---
*Dibuat dengan ❤️ untuk kemandirian finansial keluarga Indonesia.*
