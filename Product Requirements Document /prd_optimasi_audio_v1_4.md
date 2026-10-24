# Product Requirements Document (PRD) - Pembaruan & Optimasi Performa Audio (v1.3)

## 1. Ringkasan

Dokumen ini difokuskan pada perbaikan isu performa kritikal (v1.3), secara khusus menangani masalah *skipping* (audio tersendat) selama pemutaran lagu, kebocoran audio (*audio bleed*) saat transisi lagu menggunakan pintasan, dan mengoptimalkan proses pemindaian (*scanning*) file sistem di latar belakang agar tidak mengganggu *thread* utama aplikasi.

## 2. Definisi Masalah (Issue Tracker)

### A. Audio Tersendat (Skipping) & Audio Bleed pada File "Pure Audio"

* **Gejala 1 (Stuttering):** Saat memutar file musik murni (tanpa *tag* ID3/album art), pemutaran sering mengalami *skip* atau jeda sekitar 1 detik.
* **Gejala 2 (Preview Bleed saat Next/PgDn):** Saat pengguna menekan `PgDn` (Next), terdengar potongan lagu (preview/bocor) sepersekian detik, lalu audio terhenti sejenak (*skip* 1 detik), sebelum akhirnya lagu selanjutnya benar-benar diputar dengan normal.

* **Hipotesis Akar Masalah:**
  1. **Buffer Overlap (Race Condition):** Saat `PgDn` ditekan, perintah `Play` untuk lagu baru dieksekusi sebelum perintah `Stop` dan `Clear Buffer` untuk lagu lama selesai. Akibatnya, sisa audio lama (atau potongan awal lagu baru yang belum ter-load penuh) terdorong ke *speaker* secara tidak beraturan.
  2. **I/O Blocking pada Transisi:** Sistem menahan *thread* audio untuk mencari metadata lagu baru secara *synchronous*, menyebabkan *skip* 1 detik setelah lagu baru mencoba mulai.

### B. Beban Pemindaian Direktori (Scanning Overhead)

* **Gejala:** Proses membaca folder lokal yang berisi ratusan atau ribuan lagu memakan waktu dan mengganggu performa UI, berpotensi memperburuk masalah *skipping* di atas jika terjadi bersamaan.

## 3. Spesifikasi Optimasi & Solusi Teknis

### A. Optimasi Pemutaran Audio & Transisi State (Rust / Audio Engine)

1. **Buffer Flush & Transisi Sekuensial (Strict State Machine):**
   * Perbaiki logika saat tombol `Next` atau `PgDn` ditekan. Urutannya harus diubah menjadi sinkron dan tegas: 
     `Pause/Stop (Lagu A)` -> `Flush/Kosongkan Audio Buffer` -> `Load File (Lagu B)` -> `Tunggu hingga buffer awal Lagu B terisi` -> `Play (Lagu B)`.
   * Jangan biarkan *engine audio* merender suara apa pun ke *speaker* selama fase transisi ini.

2. **Pemisahan Thread (Thread Isolation):** 
   * Pastikan proses pemutaran audio berjalan di *thread* dengan prioritas tinggi (*high-priority thread*) yang sepenuhnya terpisah dari *thread* UI (React) dan *thread* pemindaian file.

3. **Caching Status Metadata (No-ID3 Cache):** 
   * Simpan status `has_metadata: false` di database SQLite untuk file *pure audio*. Saat file ini di-load, lewati (*bypass*) fungsi pencarian metadata sepenuhnya untuk menghilangkan jeda (I/O blocking) 1 detik di awal pemutaran.

### B. Optimasi Proses Pemindaian (Directory Scanning)

1. **Asynchronous Background Scanning:** Proses membaca file di direktori (seperti `/home/user/Music`) harus berjalan secara *asynchronous* (misalnya menggunakan `tokio` di Rust).
2. **Batch Insert Database:** Lakukan pengumpulan data (*batching*) setiap 50-100 file sebelum melakukan *bulk insert* ke SQLite untuk mengurangi *lock* pada disk.
3. **Lazy Loading:** Saat *scanning* sedang berlangsung, tampilkan lagu yang sudah ditemukan secara bertahap di UI React tanpa menunggu seluruh proses selesai.

## 4. Kriteria Penerimaan (Acceptance Criteria)

* Menekan `PgDn` atau `Next` menghasilkan transisi lagu yang senyap (*clean cut*) tanpa ada suara bocor/preview sepersekian detik dari trek sebelumnya atau trek baru.
* Memutar file "pure audio" dan melakukan transisi ke file tersebut berjalan mulus 100% tanpa ada *skip* atau jeda 1 detik di awal.
* Proses *scanning* file musik baru berjalan di latar belakang tanpa membuat antarmuka *freeze* atau mengganggu pemutaran audio yang sedang berlangsung.