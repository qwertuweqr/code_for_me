# Плавные скринкасты сайта для кейсов (60 fps)

Набор снимает сайт покадрово по «виртуальным часам». Анимация загрузки, прелоадер, наведения, скролл, 3D и видео на странице выходят ровно в 60 кадров в секунду, без рывков, на любом компьютере. Потом ролик собирается в слот кейса на подложке и кодируется в WebM и MP4.

## Как запустить с Claude Code (проще всего)

1. Распакуй папку, например в `C:\playhard-video`.
2. В приложении Claude: **Новое** → в выборе среды вместо облака выбери **локальную** → папка `playhard-video`.
3. Напиши: «Прочитай CLAUDE.md и сними первый ролик — главную unitodi.ru».

Дальше Claude сам ставит зависимости, изучает сайт, снимает, проверяет кадры и показывает результат.

## Вручную (Windows)

1. Поставь Node.js 18+ с https://nodejs.org.
2. Запусти `setup.bat` — один раз, ставит зависимости и chrome-headless-shell.
3. Запусти `probe-site.bat` — разведка сайта: отчёт и скриншоты в `probe\`.
4. Запусти `make-home.bat` — ролик главной: `out\01-home\01-home.webm`, `.mp4`, `-poster.jpg` и `preview.html`.

## Команды

| Команда | Что делает |
|---|---|
| `npm test` | самопроверка на тестовой странице |
| `node probe.mjs https://unitodi.ru/` | разведка: меню, секции, библиотеки, прелоадер |
| `node make.mjs scenarios/01-home.json --draft` | быстрый черновик в 1× |
| `node make.mjs scenarios/01-home.json` | чистовик |
| `node make.mjs scenarios/01-home.json --compose` | пересобрать без пересъёмки, например после смены подложки |

Сценарии и все поля описаны в `CLAUDE.md`.

## Вставка на сайт

```html
<video autoplay muted loop playsinline preload="metadata" poster="01-home-poster.jpg">
  <source src="01-home.webm" type="video/webm">
  <source src="01-home.mp4" type="video/mp4">
</video>
```
