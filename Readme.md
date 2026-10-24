# MP3 Player Lokal (Tauri + React)

Aplikasi pemutar musik lokal (*offline desktop music player*) modern dan ringan yang dibangun dengan kombinasi **Tauri v2 (Rust)** di sisi backend dan **React + Vite** di sisi frontend.

---

## 🏗️ Arsitektur Sistem

Aplikasi ini menggunakan pola arsitektur desktop modern:
1. **Frontend (React 19 + Zustand)**: Menangani antarmuka visual (UI/UX), status pemutaran audio di browser, antrean lagu (*queue*), dan interaktivitas.
2. **Backend (Rust + Tauri v2)**: Menangani operasi intensif ke sistem operasi seperti rekursif scanning folder, parsing tag ID3 file audio, ekstraksi cover album/lirik, dan manajemen database lokal.
3. **IPC Bridge (`tauri::command` & `@tauri-apps/api`)**: Jembatan komunikasi asinkron antara frontend dan backend.
4. **Local Database (SQLite via Rusqlite)**: Menyimpan cache direktori, metadata lagu, dan playlist untuk loading instan.

```
┌────────────────────────────────────────────────────────┐
│                   React 19 Frontend                    │
│  - Zustand Store (usePlayerStore.js)                   │
│  - 3-Panel Layout (NavPanel, MainPanel, QueuePanel)    │
│  - Audio Player Bar & Controls (AudioPlayer.jsx)       │
└───────────────────────────┬────────────────────────────┘
                            │
               Tauri IPC (invoke commands)
                            │
┌───────────────────────────▼────────────────────────────┐
│                    Tauri Rust Backend                  │
│  - commands.rs (IPC Handler)                           │
│  - scanner.rs  (WalkDir + Lofty ID3 Metadata & Art)    │
│  - db.rs       (SQLite / music.db - Rusqlite)          │
└────────────────────────────────────────────────────────┘
```

---

## 📂 Penjelasan Core Files

### 1. Backend Core (`src-tauri/`)

* **[`src-tauri/src/main.rs`](src-tauri/src/main.rs)**
  * Titik masuk (*entry point*) executable binary aplikasi Tauri.
  * Mengatur konfigurasi subsistem OS (misal: menyembunyikan console window pada rilis Windows) dan memanggil fungsi `run()` dari `lib.rs`.

* **[`src-tauri/src/lib.rs`](src-tauri/src/lib.rs)**
  * Pusat inisialisasi lifecycle aplikasi Tauri.
  * Mengaktifkan plugin resmi (`tauri_plugin_opener`, `tauri_plugin_dialog`).
  * Menginisialisasi folder data aplikasi (`app_data_dir`) dan database SQLite `music.db`.
  * Mendaftarkan seluruh fungsi *IPC commands* ke `invoke_handler` agar dapat diakses oleh React.

* **[`src-tauri/src/db.rs`](src-tauri/src/db.rs)**
  * Modul database SQLite lokal menggunakan crate `rusqlite`.
  * Membungkus koneksi database ke dalam struct thread-safe `DbState(Mutex<Connection>)`.
  * Menjalankan migrasi/pembuatan tabel saat aplikasi pertama kali dijalankan:
    * `music_dirs`: Menyimpan daftar folder yang pernah di-scan.
    * `songs`: Menyimpan metadata lengkap lagu (path, title, artist, album, duration, year, genre, cover flag, lyrics flag).
    * `playlists`: Menyimpan daftar playlist pengguna.
    * `playlist_songs`: Tabel penghubung relasi many-to-many lagu dan playlist beserta urutan posisinya.
    * Indeks database untuk mempercepat query pencarian judul, artis, dan album.

* **[`src-tauri/src/scanner.rs`](src-tauri/src/scanner.rs)**
  * Mesin penjelajah filesystem dan pembaca metadata audio:
    * `scan_dir()`: Menggunakan `walkdir` untuk menelusuri folder musik secara rekursif mencari ekstensi audio didukung (`.mp3`, `.flac`, `.ogg`, `.m4a`, `.wav`).
    * `extract_metadata()`: Menggunakan crate `lofty` untuk membaca metadata ID3, durasi presisi, dan ketersediaan cover/lirik.
    * `get_album_art_data()`: Mengekstrak cover gambar yang tertanam di file audio dan mengonversinya menjadi format base64 Data URL (`data:image/...;base64,...`).
    * `get_lyrics_data()`: Membaca tag lirik lagu (*USLT / Unsynchronized Lyrics*) langsung dari metadata audio.

* **[`src-tauri/src/commands.rs`](src-tauri/src/commands.rs)**
  * Kumpulan fungsi Tauri Command (IPC) yang menghubungkan frontend dan backend:
    * **Lagu**: `get_all_songs`, `search_songs`, `read_audio_file`.
    * **Folder**: `scan_directory`, `get_music_dirs`, `remove_music_dir`.
    * **Playlist**: `get_playlists`, `create_playlist`, `delete_playlist`, `add_songs_to_playlist`, `remove_song_from_playlist`, `get_playlist_songs`.
    * **Aset**: `get_lyrics`, `get_album_art`.

---

### 2. Frontend Core (`src/`)

* **[`src/main.jsx`](src/main.jsx)**
  * Titik masuk rendering React DOM yang memuat komponen root `<App />` ke elemen `#root`.

* **[`src/App.jsx`](src/App.jsx)**
  * Komponen shell utama aplikasi.
  * Mengatur struktur layout 3 panel:
    * Kiri: `NavPanel`
    * Tengah: `MainPanel`
    * Kanan: `QueuePanel`
    * Bawah: `AudioPlayer`
  * Melakukan *initial fetch* data lagu dan playlist saat aplikasi pertama kali dimuat.
  * Merender sistem notifikasi toast global.

* **[`src/store/usePlayerStore.js`](src/store/usePlayerStore.js)**
  * Pusat manajemen state aplikasi menggunakan **Zustand**.
  * **Library State**: Menyimpan koleksi lagu (`songs`), daftar playlist, filter pencarian (`searchQuery`), opsi pengurutan (`sortBy`, `sortOrder`), serta view aktif.
  * **Queue State**: Mengelola antrean putar (`queue`), indeks lagu aktif (`currentIndex`), fungsi tambah/hapus, dan reorder antrean.
  * **Playback State**: Mengontrol status `isPlaying`, durasi, waktu berjalan (`currentTime`), `volume`, status mute, acak lagu (`isShuffled`), dan mode perulangan (`repeatMode`: none/one/all).
  * **UI & Cache State**: Mengatur modal lirik (`showLyrics`, `lyricsContent`), cache cover album (`albumArtCache`), dan indikator proses scanning.

* **[`src/lib/api.js`](src/lib/api.js)**
  * Layer abstraksi API untuk memanggil Tauri IPC command (`invoke`).
  * Menyediakan fungsi helper:
    * `readAudioFile(path)`: Membaca raw bytes dari file audio lokal melalui Rust dan mengubahnya menjadi native browser `Blob URL` yang stabil untuk dimainkan tag audio HTML5.
    * `formatDuration(secs)`: Memformat detik ke format waktu `MM:SS`.

---

### 3. Komponen Antarmuka (`src/components/`)

* **[`src/components/AudioPlayer/AudioPlayer.jsx`](src/components/AudioPlayer/AudioPlayer.jsx)**
  * Mengelola elemen HTML5 `<audio>` dan audio playback logic.
  * **Fitur Caching & Pre-loading Pintar**: Otomatis memuat track lagu berikutnya beserta cover albumnya di latar belakang (*background pre-load*) ke dalam in-memory bounded cache, sehingga penekanan tombol **Next** berlangsung instan tanpa jeda I/O.
  * Fitur: Play/Pause, Seekbar interaktif dengan waktu real-time, pengatur volume/mute, tombol Shuffle, tombol Repeat mode, tombol Next/Previous, dan tombol toggle penampil Lirik lagu.

* **[`src/components/NavPanel/NavPanel.jsx`](src/components/NavPanel/NavPanel.jsx)**
  * Sidebar navigasi di sisi kiri.
  * Mengelola pemilihan folder musik menggunakan dialog sistem (`@tauri-apps/plugin-dialog`), menampilkan daftar folder aktif, dan mengelola playlist (tambah baru & hapus).

* **[`src/components/MainPanel/MainPanel.jsx`](src/components/MainPanel/MainPanel.jsx)**
  * Panel utama di bagian tengah.
  * Menampilkan daftar lagu perpustakaan atau lagu dalam playlist aktif.
  * Menyediakan input pencarian instan (*realtime search*), sorting berdasarkan judul/artis/album/durasi, serta menu aksi (tambah ke antrean, putar langsung, atau masukkan ke playlist).

* **[`src/components/QueuePanel/QueuePanel.jsx`](src/components/QueuePanel/QueuePanel.jsx)**
  * Sidebar antrean di sisi kanan.
  * Menampilkan daftar lagu yang sedang mengantre untuk diputar.
  * Mendukung pengaturan ulang urutan lagu menggunakan drag-and-drop (**@dnd-kit**), hapus per item, dan pembersihan antrean (*Clear Queue*).

---

## 🛠️ Ringkasan Teknologi & Dependensi

| Layer | Komponen / Library | Kegunaan |
|---|---|---|
| **Backend** | Rust, Tauri v2 | Framework desktop native yang hemat memori & cepat |
| **Database** | Rusqlite (SQLite) | Penyimpanan metadata lokal, folder, dan playlist |
| **Audio Metadata** | Lofty | Ekstraksi tag ID3, album cover, dan lirik lagu |
| **Filesystem Walk** | Walkdir | Penelusuran file dan direktori secara rekursif |
| **Frontend** | React 19, Vite | Library UI reaktif dan build tool performa tinggi |
| **State Management** | Zustand | State management global yang ringan dan terpusat |
| **Drag & Drop** | @dnd-kit | Manipulasi urutan lagu pada antrean (*queue*) |

---

## 🚀 Cara Menjalankan Project

1. Pastikan dependensi Rust dan Node.js sudah terinstal.
2. Install dependensi frontend:
   ```bash
   npm install
   ```
3. Jalankan aplikasi dalam mode pengembangan:
   ```bash
   npm run tauri dev
   ```
