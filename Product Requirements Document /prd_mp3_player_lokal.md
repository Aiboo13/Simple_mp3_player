# Product Requirements Document (PRD): MP3 Player Lokal (Tauri + React)

## 1. Ringkasan Eksekutif

Aplikasi pemutar MP3 desktop berbasis luring (offline) yang dibangun menggunakan arsitektur Tauri dan React, **dirancang khusus untuk sistem operasi Ubuntu**. Aplikasi ini berfokus pada manajemen file musik lokal yang efisien dengan antarmuka yang mengusung gaya desain *Brutalism*. Fitur utama mencakup manajemen antrian dengan mekanisme *drag-and-drop*, integrasi lirik dinamis, dan tata letak spasial yang responsif untuk mengoptimalkan pengalaman navigasi di lingkungan desktop Ubuntu.

## 2. Spesifikasi Desain & Antarmuka (UI/UX)

* **Tema Visual:** Brutalism Website. Menggunakan garis batas tebal (*solid black borders*), warna latar primer yang kontras tinggi (merah, kuning, atau biru solid), tipografi tebal atau asimetris (*bold/monospaced*), dan bayangan statis (*hard drop shadows* tanpa efek *blur*).

* **Struktur Tata Letak (Layout Tiga Panel):**

  * **Panel Navigasi (Kiri):** Berisi menu utama, daftar *playlist*, kotak pencarian (*Search Box*), dan akses utama ke tab *Full Music*.

  * **Panel Utama (Tengah):** Berfungsi sebagai fokus visual. Menampilkan daftar lagu atau *cover* foto album dari lagu yang sedang diputar dengan ukuran besar. Jika area foto album ditekan (klik), tampilan akan bertransisi memunculkan panel lirik lagu.

  * **Panel Antrian (Kanan):** Menampilkan daftar antrian lagu (*Queue*) yang sedang atau akan diputar berdasarkan *playlist* aktif. *(Penempatan di sisi kanan menyeimbangkan panel navigasi di kiri untuk ergonomi desktop).*

## 3. Kebutuhan Fungsional (Core Features)

* **Tab Full Music (Perpustakaan Utama):**

  * Menampilkan seluruh file MP3 dari direktori lokal yang diizinkan di Ubuntu (misalnya `/home/username/Music`).

  * Mendukung fungsi *Sorting* (Pengurutan) berdasarkan:

    * Nama Lagu (Alfabetis A-Z / Z-A).

    * Tanggal Ditambahkan (*Date Added* / Berdasarkan metadata pembuatan file di OS).

* **Manajemen Antrian & Playlist:**

  * Pengguna dapat memuat *playlist* secara utuh, yang otomatis masuk ke dalam panel Antrian.

  * Fitur *Drag-and-Drop*: Pengguna dapat mengklik, menahan, dan menggeser item lagu di dalam panel Antrian untuk menyusun ulang urutan pemutaran secara *real-time*.

* **Pemutar & Interaksi Lirik:**

  * Kontrol audio standar (Play, Pause, Next, Prev, Seek, Volume).

  * Mekanisme *toggle* lirik melalui interaksi klik pada foto album. Lirik diekstraksi dari *tag* ID3 internal MP3 atau file teks `.lrc` terpisah.

## 4. Spesifikasi Teknis (Tech Stack)

* **Target Platform:** Ubuntu (Linux). Distribusi rilis aplikasi disiapkan dalam format `.deb` atau `AppImage` menggunakan *bundler* bawaan Tauri.

* **Frontend UI:** React.js.

* **Drag-and-Drop Engine:** `dnd-kit` (disarankan untuk React) untuk menangani pergeseran antrian yang mulus tanpa mengganggu pemutaran audio.

* **Styling:** Tailwind CSS (dengan modifikasi konfigurasi utilitas khusus untuk menghasilkan gaya grafis Brutalism seperti `border-4`, `shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]`).

* **Backend & Jembatan Sistem File:** Tauri (Rust). Menangani pemindaian direktori, pembacaan file audio melalui skema Asset Protocol, dan ekstraksi metadata menggunakan *library* Rust (seperti `lofty` atau `id3`).

* **Manajemen State/Database Lokal:** SQLite (di sisi Rust) untuk menyimpan indeks *path* file, *tag* ID3, dan *playlist*, sehingga proses pencarian dan *sorting* berjalan instan tanpa membebani memori WebView React.

## 5. Kriteria Penerimaan (Acceptance Criteria)

* Aplikasi berhasil diinstal, dijalankan, dan merender antarmuka dengan stabil di sistem operasi Ubuntu tanpa adanya isu dependensi (teruji dalam format `.deb`).

* Aplikasi berhasil membaca dan memutar file MP3 dari direktori lokal Ubuntu tanpa perlu koneksi internet.

* Komponen antrian merespons *drag-and-drop* dengan presisi; urutan pemutaran audio (mesin audio) langsung beradaptasi dengan urutan visual yang baru.

* Sistem berhasil merender tab *Full Music* dengan opsi *sorting* yang berfungsi tanpa *lag*.

* Elemen visual secara konsisten mematuhi estetika desain *Brutalism* di seluruh interaksi tombol, panel, dan modal.