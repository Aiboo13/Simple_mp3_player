# Product Requirements Document (PRD) - Pembaruan & Optimasi Performa Audio (v1.3)

## 1. Ringkasan
Dokumen ini difokuskan pada perbaikan isu performa kritikal (v1.3), secara khusus menangani masalah *skipping* (audio tersendat) selama pemutaran lagu, dan mengoptimalkan proses pemindaian (*scanning*) file sistem di latar belakang agar tidak mengganggu *thread* utama aplikasi.

## 2. Definisi Masalah (Issue Tracker)

### A. Audio Tersendat (Skipping) pada File "Pure Audio"
* **Gejala:** Saat memutar file musik yang murni hanya berisi audio (tanpa metadata, *tag* ID3, atau *embedded album art*), pemutaran sering mengalami *skip* atau jeda sekitar 1 detik.
* **Hipotesis Akar Masalah:** 
  1. **I/O Blocking:** Sistem (Rust atau React) mungkin terus-menerus mencoba membaca/mem-parsing metadata yang tidak ada secara sinkron (*synchronous*), yang menyebabkan *thread* audio tertahan.
  2. **Buffer Underrun:** Mesin pemutar tidak melakukan *buffering* dengan ukuran yang cukup besar, sehingga ketika sistem sedang sibuk melakukan *scanning* atau tugas lain, pasokan data audio terputus sejenak.

### B. Beban Pemindaian Direktori (Scanning Overhead)
* **Gejala:** Proses membaca folder lokal yang berisi ratusan atau ribuan lagu memakan waktu dan mengganggu performa aplikasi secara keseluruhan (berpotensi memicu masalah *skipping* di atas).

## 3. Spesifikasi Optimasi & Solusi Teknis

### A. Optimasi Pemutaran Audio & Buffering (Rust / Audio Engine)
1. **Pemisahan Thread (Thread Isolation):** Pastikan proses pemutaran audio berjalan di *thread* dengan prioritas tinggi (*high-priority thread*) yang sepenuhnya terpisah dari *thread* UI (React) dan *thread* pemindaian file.
2. **Peningkatan Ukuran Buffer:** Tingkatkan ukuran *buffer* pemutaran audio bawaan di *backend* (atau tag `<audio>` di frontend) agar dapat menyimpan memori audio beberapa detik ke depan. Ini mencegah *skip* jika disk sedang sibuk.
3. **Caching Status Metadata (No-ID3 Cache):** Jika saat pemindaian awal terdeteksi bahwa file tersebut adalah "pure audio" (tidak memiliki lirik, *cover*, atau metadata), simpan status `has_metadata: false` di database SQLite. Saat memutar file ini, lewati (*bypass*) semua fungsi pencarian metadata agar tidak membebani sistem.

### B. Optimasi Proses Pemindaian (Directory Scanning)
1. **Asynchronous Background Scanning:** Proses membaca file di direktori (seperti `/home/user/Music`) harus berjalan secara *asynchronous* (misalnya menggunakan `tokio` di Rust).
2. **Batch Insert Database:** Jangan melakukan *write* ke database SQLite satu per satu setiap kali menemukan 1 file lagu. Kumpulkan data (*batching*) setiap 50 atau 100 file, lalu lakukan *bulk insert* untuk mengurangi *lock* pada disk.
3. **Lazy Loading / Progressive Rendering:** Saat *scanning* sedang berlangsung, tampilkan lagu yang sudah ditemukan secara bertahap di daftar *Full Music* React, alih-alih menunggu seluruh proses *scanning* selesai.

## 4. Kriteria Penerimaan (Acceptance Criteria)
* Memutar file "pure audio" dari awal hingga akhir berjalan mulus 100% tanpa ada *skip* atau jeda 1 detik.
* Proses *scanning* ratusan file musik baru tidak membuat aplikasi *freeze* dan pengguna tetap dapat memutar lagu saat proses *scanning* berjalan di latar belakang.
* Penggunaan CPU dan Disk (I/O) saat aplikasi dalam keadaan diam (*idle* tapi sedang memutar lagu) harus stabil dan rendah.