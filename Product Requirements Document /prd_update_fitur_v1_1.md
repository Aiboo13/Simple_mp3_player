# Product Requirements Document (PRD) - Pembaruan Fitur MP3 Player (v1.1)

## 1. Ringkasan
Dokumen ini merupakan ekstensi (addendum) dari PRD utama MP3 Player Lokal. Pembaruan ini berfokus pada peningkatan kenyamanan navigasi pengguna (melalui *keyboard shortcuts* dan menu klik kanan) serta perombakan antarmuka pada area pemutar utama untuk menampilkan lirik dan album secara lebih dinamis.

## 2. Detail Pembaruan Fitur

### A. Tampilan Album dan Lirik Berdampingan (Side-by-Side)
* **Deskripsi:** Panel utama di bagian tengah tidak lagi membutuhkan klik pada *cover* untuk memunculkan lirik. Gambar *cover* album/single akan ditampilkan secara permanen bersebelahan langsung dengan teks lirik yang bergulir.
* **Kondisi Khusus (Edge Case):** Jika data lirik (baik dari *tag* ID3 maupun file `.lrc`) tidak ditemukan pada lagu yang sedang diputar, maka area lirik dibiarkan kosong sepenuhnya (blank). **Tidak boleh** ada teks informasi atau peringatan seperti "Lirik tidak tersedia" atau "No Information".

### B. Mode Layar Penuh (Fullscreen) untuk Lirik
* **Deskripsi:** Pengguna dapat memperbesar area lirik agar memenuhi seluruh jendela aplikasi.
* **Mekanisme UI:** Saat mode layar penuh diaktifkan, panel navigasi dasar (panel kiri) dan panel antrian (panel kanan) akan disembunyikan (*hidden*). Tampilan hanya berfokus pada lirik dan kontrol pemutar dasar.

### C. Pintasan Keyboard (Keyboard Shortcuts)
* **Deskripsi:** Implementasi *global* atau *window-level shortcuts* untuk mempercepat interaksi pengguna tanpa menggunakan mouse.
* **Daftar Pintasan:**
  * `Ctrl + F` : Otomatis memindahkan fokus kursor (*auto-focus*) ke dalam kotak pencarian (*Search Box*).
  * `Page Up` (PgUp) : Memutar musik sebelumnya (*Previous Music*).
  * `Page Down` (PgDn) : Memutar musik selanjutnya (*Next Music*).

### D. Konteks Menu "Play Next" (Klik Kanan)
* **Deskripsi:** Menambahkan interaksi klik kanan (*Right-Click Context Menu*) pada setiap baris lagu, baik di daftar *Full Music* maupun di panel navigasi lainnya.
* **Fungsi:** Saat pengguna memilih opsi "Play Next", sistem akan langsung menyisipkan lagu tersebut ke dalam antrian (*queue*) tepat di bawah lagu yang saat ini sedang diputar (urutan kedua di antrian aktif), tanpa mengganggu lagu yang sedang berjalan.

## 3. Catatan Teknis Tambahan
* **Event Listeners:** Untuk fitur pintasan keyboard, integrasi dapat dilakukan di tingkat jendela Tauri (`tauri/api/globalShortcut` jika diaplikasikan secara global di OS) atau menggunakan *event listener* `keydown` murni di React (jika hanya aktif saat jendela aplikasi sedang fokus).
* **Context Menu:** Pembuatan menu klik kanan harus mematuhi estetika desain *Brutalism* (misalnya dengan kotak menu bergaris tepi tebal dan bayangan padat) agar konsisten dengan tema utama aplikasi.