# Product Requirements Document (PRD) - Penanganan File Pure Audio (v1.5)

## 1. Ringkasan Eksekutif

Dokumen (Patch v1.5) ini secara eksklusif menargetkan perbaikan *bug* kritikal pada mesin pemutar audio (*audio engine*) yang terjadi **hanya pada file musik murni (*pure audio files*)**. File *pure audio* didefinisikan sebagai file biner `.mp3` yang sama sekali tidak memiliki sisipan metadata, ID3 *tags*, sampul album, maupun data lirik.

## 2. Definisi Masalah (Bug Report)

* **Skenario:** Pengguna memutar file *pure audio* secara langsung atau melakukan transisi ke file tersebut menggunakan tombol *Next/Prev* atau pintasan *keyboard* (`PgDn` / `PgUp`).
* **Gejala 1 (Audio Spill / Bocor):** Sesaat setelah perintah *Next/Prev/Play* dieksekusi, terdengar potongan atau tumpahan (*spill*) audio dari lagu tersebut selama sepersekian detik secara tidak wajar.
* **Gejala 2 (Skip / Stutter 1 Detik):** Tepat setelah *spill* terjadi, pemutaran mengalami jeda paksa, *skip*, atau tersendat selama kurang lebih 1 detik, sebelum akhirnya lagu kembali diputar secara normal.

## 3. Hipotesis Akar Masalah (Root Cause Analysis)

Isu ini terjadi karena absennya *header* metadata (ID3) pada file. 
1. **Penyebab Skip 1 Detik:** Secara bawaan, *decoder* audio (di *backend* Rust/Tauri) akan memindai awal file untuk mencari metadata. Karena metadata tidak ada, *decoder* terus memindai (*scanning forward*) mencari *frame* audio pertama yang valid. Proses pencarian (fallback) ini memblokir *thread* utama audio selama ±1 detik.
2. **Penyebab Audio Spill:** Saat *decoder* sedang kebingungan mencari *frame* pertama, saluran *output* (sink) ke *speaker* sudah terlanjur dibuka. Akibatnya, *frame* mentah yang kebetulan terbaca langsung terdorong ke *speaker* (menghasilkan *spill*), lalu terhenti karena *decoder* melakukan *reset* atau penyesuaian *sample rate* setelah menyadari itu adalah *pure audio*.

## 4. Spesifikasi Solusi Teknis (Engineering Requirements)

Untuk menyelesaikan masalah ini, tim pengembang harus mengimplementasikan logika berikut pada *audio engine*:

### A. Strict Mute on Transition (Mute Paksa saat Transisi)
* **Aturan:** Setiap kali perintah *Play/Next/Prev* (`PgDn`/`PgUp`) ditekan, *audio sink* (saluran *output* suara) **wajib di-mute (volume = 0)** atau diputus sementara.
* **Kondisi Unmute:** *Sink* hanya boleh di-unmute setelah *decoder* mengonfirmasi bahwa *buffer* audio sudah stabil dan siap merender *frame* pertama secara berkelanjutan. Ini akan mencegah 100% kasus *audio spill*.

### B. Fast-Fail Metadata Scanning (Bypass Metadata)
* **Aturan:** Berikan batas waktu (*timeout*) sangat singkat (misalnya 10ms - 50ms) bagi *decoder* untuk membaca metadata di awal file.
* Jika dalam 50ms tidak ditemukan *header* ID3, sistem harus langsung mengasumsikan file tersebut adalah **Pure Audio**, menghentikan pencarian metadata, dan langsung memulai proses *decoding frame* suara. Ini akan menghilangkan jeda/skip 1 detik.

### C. Pre-buffering Pure Audio
* Untuk file yang sudah ditandai sebagai *pure audio* (dari proses *scanning* awal SQLite), lewati proses pencarian metadata sepenuhnya saat *load* ke *player*. Langsung isi *buffer* dengan data suara mentah.

## 5. Kriteria Penerimaan (Acceptance Criteria)

* Saat menavigasi ke file *pure audio* menggunakan `PgDn` atau `PgUp`, perpindahan lagu harus terjadi dengan mulus tanpa ada suara *spill* (bocor/kaget) di awal.
* Jeda 1 detik (*skip/stutter*) yang sebelumnya muncul setelah transisi ke file *pure audio* hilang sepenuhnya, musik langsung berlanjut ke tempo yang benar.
* Aturan ini tidak merusak pemutaran file MP3 standar yang memiliki lirik atau metadata (regresi nihil).