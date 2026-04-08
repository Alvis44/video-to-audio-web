# 🎬 → 🎵 Video to Audio Converter

Конвертация видео в аудио — прямо в браузере. Вся обработка выполняется локально на устройстве пользователя, ничего не загружается на сервер.

## Возможности

- Конвертация видео → MP3, WAV, AAC (M4A), OGG, FLAC
- Drag & drop или выбор файла
- Прогресс-бар в реальном времени  
- Звуковое и push-уведомление при завершении
- Лог FFmpeg
- Максимальный размер файла — 2 ГБ (ограничение WebAssembly)

## Технологии

- [ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm) — FFmpeg скомпилированный в WebAssembly
- [Vite](https://vitejs.dev/) — сборка
- Vanilla JS — без фреймворков

## Разработка

```bash
npm install
npm run dev
```

Dev-сервер: `http://localhost:5173/`

## Сборка

```bash
npm run build
```

Результат в `dist/` — готовая статика для деплоя.

## Деплой

Автоматический деплой на GitHub Pages при пуше в `main` через GitHub Actions.

**Настройка:**
1. Settings → Pages → Source: **GitHub Actions**
2. Push в `main` — сайт появится на `https://<username>.github.io/<repo-name>/`

## Автор

- [GitHub](https://github.com/Alvis44)
- [Поддержать ☕](https://pay.cloudtips.ru/p/cd42a9bf)
