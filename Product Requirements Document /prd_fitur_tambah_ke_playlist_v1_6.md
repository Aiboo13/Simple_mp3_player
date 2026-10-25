# Product Requirements Document (PRD) - Fitur Tambah ke Playlist (v1.6)

## 1. Ringkasan Eksekutif

Dokumen (Patch v1.6) ini mendefinisikan spesifikasi untuk melengkapi fitur *Playlist* yang sudah ada. Saat ini antarmuka *playlist* sudah tersedia, namun fungsionalitas untuk memasukkan lagu ke dalamnya belum diimplementasikan. Pembaruan ini akan menambahkan kemampuan seleksi tunggal maupun ganda (*multi-select*) menggunakan pintasan *keyboard*, serta mengintegrasikannya ke dalam menu klik kanan (*context menu*).

## 2. Spesifikasi Interaksi Pengguna (UI/UX)

### A. Mekanisme Seleksi Lagu
Pengguna harus dapat memilih satu atau beberapa lagu sekaligus dari daftar *Full Music* sebelum melakukan aksi.
* **Seleksi Tunggal:** Klik kiri satu kali (atau klik kanan langsung) pada satu baris lagu untuk memilihnya.
* **Seleksi Ganda (Multi-Select):** 
  * Pengguna menekan dan menahan tombol `Ctrl` (atau `Cmd` di Mac, jika didukung).
  * Sambil menahan `Ctrl`, pengguna mengklik kiri beberapa lagu berbeda. Lagu yang diklik akan mendapatkan status *highlighted* (tersorot visual).
  * Jika lagu yang sudah tersorot diklik lagi sambil menahan `Ctrl`, lagu tersebut akan batal dipilih (*deselect*).

### B. Konteks Menu (Right-Click Menu)
* Saat pengguna melakukan klik kanan pada area lagu yang sedang diseleksi (baik satu maupun banyak lagu), *Context Menu* akan muncul.
* Menu ini akan mempertahankan opsi yang sudah ada (seperti "Play Next") dan menambahkan satu opsi baru: **"Tambahkan ke Playlist..."**
* **Interaksi Sub-Menu:** Saat opsi "Tambahkan ke Playlist..." disorot/diklik, akan muncul daftar *playlist* yang sudah ada di database, beserta satu opsi paling atas/bawah untuk **"+ Buat Playlist Baru"**.

## 3. Kebutuhan Teknis (Engineering Requirements)

### A. Frontend (React)
1. **State Management Seleksi:** Implementasikan *state* berupa *array* `selectedSongIds` untuk menyimpan daftar ID lagu yang sedang dipilih.
2. **Event Listener Ctrl+Click:** Tambahkan logika pada `onClick` baris lagu untuk mendeteksi `event.ctrlKey`. Jika *true*, tambahkan/hapus ID dari *state array*. Jika *false* (klik biasa), kosongkan *array* dan hanya masukkan ID lagu yang baru diklik.
3. **Komponen Context Menu:** Modifikasi *Context Menu* agar membaca *array* `selectedSongIds`. Saat aksi dikirim ke *backend*, kirimkan seluruh ID tersebut dalam bentuk *batch* (array).

### B. Backend (Tauri / Rust & SQLite)
1. **Skema Database:** Pastikan terdapat tabel relasi (*junction table*), misalnya `playlist_songs` dengan kolom `playlist_id` dan `song_id`.
2. **Batch Insert:** Buat fungsi *invoke* di Tauri yang menerima ID *playlist* target dan *array* ID lagu. Lakukan *batch insert* ke database SQLite untuk menghindari pemanggilan *query* yang berulang-ulang, guna menjaga performa tetap optimal (mencegah *force close* seperti isu di v1.2).

## 4. Kriteria Penerimaan (Acceptance Criteria)

* Pengguna dapat memilih banyak lagu sekaligus secara acak dengan menahan tombol `Ctrl` + Klik Kiri.
* Klik kanan pada lagu yang terseleksi memunculkan menu dengan opsi "Tambahkan ke Playlist".
* Memilih sebuah *playlist* dari menu tersebut akan berhasil memasukkan semua lagu yang terseleksi ke dalam *playlist* terkait di database.
* Lagu yang baru ditambahkan langsung muncul saat pengguna membuka tab *playlist* tersebut tanpa perlu me-*restart* aplikasi.
* Desain visual *highlight* seleksi ganda dan *Context Menu* tetap mematuhi pedoman tema *Brutalism* (garis tegas, kontras tinggi).