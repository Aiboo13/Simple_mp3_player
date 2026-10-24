# Product Requirements Document (PRD) - Pembaruan & Perbaikan Bug (v1.2)

## 1. Ringkasan

Dokumen ini berisi spesifikasi untuk rilis perbaikan (patch) v1.2. Fokus utama pada fase ini adalah meningkatkan stabilitas aplikasi (mencegah *force close*), memperbaiki logika sistem antrian (*queue logic bug*), dan menyempurnakan interaksi pengguna untuk mencegah kesalahan klik saat aplikasi sedang berjalan.

## 2. Penyesuaian Pengalaman Pengguna (UX Tweaks)

### A. Klik Ganda (Double Click) untuk Memutar Lagu
* **Masalah:** Pengguna sering tidak sengaja menekan lagu di daftar *Full Music* dengan sekali klik, yang mengakibatkan lagu yang sedang diputar tiba-tiba terhenti dan berganti ke lagu yang tidak sengaja tertekan.
* **Solusi:** Ubah *trigger* pemutaran lagu dari sekali klik (`onClick`) menjadi klik ganda (`onDoubleClick`).
* **Perilaku Baru:** 
  * Sekali klik hanya akan menyorot (*highlight* / *select*) baris lagu tersebut.
  * Klik ganda baru akan memicu aksi pemutaran lagu dan mengganti antrian yang sedang berjalan.

## 3. Optimasi Performa & Stabilitas

### A. Pencegahan Force Close akibat *Action Spamming*
* **Masalah:** Aplikasi mengalami *force close* (crash) ketika pengguna melakukan terlalu banyak aksi atau transaksi dalam waktu singkat (misalnya: menekan tombol *next* berkali-kali secara cepat, melakukan *drag-and-drop* antrian berulang dengan sangat cepat, atau *spam* klik kanan).
* **Solusi & Kebutuhan Teknis:**
  * **Debounce / Throttle:** Implementasikan *debouncing* atau *throttling* pada fungsi-fungsi yang memicu perubahan *state* berat atau pemanggilan ke *backend* Tauri (Rust). Batasi eksekusi aksi maksimal setiap 200-300ms.
  * **Manajemen Memori (Memory Leak Check):** Pastikan tidak ada penduplikasian *event listener* setiap kali komponen di-render ulang (*re-render*). Pastikan juga proses pembacaan file di backend Rust dikelola menggunakan *thread pool* yang aman agar tidak membebani CPU hingga *panic*.
  * **Error Handling:** Tambahkan blok *try-catch* (React) dan *Result handling* (Rust) yang memadai agar jika terjadi penumpukan aksi, aplikasi hanya mengabaikan aksi tambahan, bukan menutup paksa.

## 4. Perbaikan Bug (Bug Fixes)

### A. Sinkronisasi Logika Antrian "Play Next" (Priority: High)
* **Deskripsi Bug:** Saat pengguna menekan "Play Next" melalui konteks menu (klik kanan), lagu berhasil masuk secara visual ke dalam urutan panel antrian (di bawah lagu yang sedang diputar). Namun, saat lagu saat ini selesai (*auto-play*) atau pengguna menekan tombol *Next*, lagu yang ditambahkan tersebut terlewati/tidak diputar, dan pemutar malah beralih ke lagu lain.
* **Akar Masalah (Diagnosa Awal):** Terjadi ketidaksinkronan (*desync*) antara *state* visual (daftar antrian di React UI) dengan *state* aktual pada mesin audio/Tauri. Mesin audio masih menggunakan indeks atau *array* lama sebelum lagu disisipkan.
* **Kriteria Penyelesaian (Acceptance Criteria):**
  * Ketika "Play Next" ditekan, *state global* antrian harus diperbarui sedemikian rupa sehingga indeks pemutaran lagu selanjutnya (+1 dari indeks saat ini) benar-benar menunjuk pada lagu yang baru disisipkan.
  * Event `onEnded` (lagu habis) dari mesin pemutar audio harus mengambil referensi dari daftar antrian terbaru yang sudah disisipkan lagu baru.
  * Menekan tombol manual `Next` (`PgDn` atau klik UI) tepat setelah menekan "Play Next" pada suatu lagu, harus memutar lagu yang baru disisipkan tersebut.