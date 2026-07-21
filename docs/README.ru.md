# CoolControl — управление кулерами для Linux

**CoolControl** — приложение для Linux, которое позволяет управлять мощностью
кулеров (скоростью вращения вентиляторов) через подсистему ядра `hwmon`. Оно
показывает обороты вентиляторов и температуры в реальном времени и даёт три
способа управления: ручные ползунки, готовые профили и редактируемые кривые
«температура → скорость». Приложение написано на **C++ (Qt 6)** — быстрое и
лёгкое, без интерпретатора.

![Дашборд](../assets/dashboard.png)

![Редактор кривых](../assets/curves.png)

---

## 📥 Как скачать программу

### Способ 1. Готовый AppImage (рекомендуется)

Это один файл, внутри которого уже есть все нужные библиотеки Qt. Ничего
устанавливать не нужно.

1. Откройте страницу релизов:
   **https://github.com/ismailpocta5-ctrl/code_for_me/releases**
2. В последнем релизе, в разделе **Assets**, скачайте файл
   **`CoolControl-x86_64.AppImage`**.
3. Сделайте файл исполняемым (в терминале, в папке со скачанным файлом):

   ```bash
   chmod +x CoolControl-x86_64.AppImage
   ```

4. Запустите:

   ```bash
   ./CoolControl-x86_64.AppImage
   ```

   Чтобы можно было менять скорость на реальном железе (нужны права root):

   ```bash
   pkexec ./CoolControl-x86_64.AppImage
   ```

> 💡 Если при первом запуске появляется ошибка про FUSE, установите его
> (`sudo apt install libfuse2`) или запустите с распаковкой:
> `./CoolControl-x86_64.AppImage --appimage-extract-and-run`.

### Способ 2. Архив с бинарниками

В том же релизе есть **`coolcontrol-linux-x86_64.tar.gz`** — распакуйте и
запустите:

```bash
tar -xzf coolcontrol-linux-x86_64.tar.gz
cd coolcontrol
./coolcontrol          # графическое приложение
./coolcontrol-cli list # версия для терминала
```

Для работы этого варианта в системе должна быть установлена Qt 6
(`sudo apt install qt6-base-dev` на Ubuntu/Debian).

### Способ 3. Сборка из исходников

```bash
# 1. Зависимости (Ubuntu / Debian)
sudo apt update
sudo apt install -y build-essential cmake ninja-build qt6-base-dev libgl1-mesa-dev

# 2. Клонируем и собираем
git clone https://github.com/ismailpocta5-ctrl/code_for_me.git
cd code_for_me
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build

# 3. Запуск
./build/coolcontrol            # GUI (демо-режим: ./build/coolcontrol --demo)
./build/coolcontrol-cli list   # CLI
```

Установка в систему (по желанию):

```bash
sudo cmake --install build      # обычно в /usr/local/bin
```

Собрать свой AppImage можно скриптом:

```bash
bash packaging/build-appimage.sh
```

---

## 🖥️ Как пользоваться

- **Профили** вверху: `Auto` (управление отдаёт прошивке), `Silent`,
  `Balanced`, `Performance` — переключаются в один клик.
- **Дашборд**: у каждого вентилятора круговой индикатор скорости, обороты (RPM)
  и ползунок для ручной установки мощности. Справа — температуры (цвет меняется
  от зелёного к красному по мере нагрева).
- **Вкладка «Fan Curves»**: перетаскивайте точки кривой, двойной клик — добавить
  точку, правый клик — удалить. Кривая применяется сразу.

Версия для терминала:

```bash
coolcontrol-cli list                         # список чипов, температур, вентиляторов
coolcontrol-cli set /sys/class/hwmon/hwmon2 pwm1 45   # 45% на pwm1
coolcontrol-cli preset Silent                # применить профиль
coolcontrol-cli auto                         # вернуть управление прошивке
```

---

## 🔐 Права доступа

Чтение датчиков работает от обычного пользователя. **Запись** скорости
вентиляторов (`/sys/class/hwmon/*/pwm*`) требует прав root — либо запускайте
через `pkexec`, либо добавьте правило udev (см. каталог
[`packaging/`](../packaging/)).

Если у вентиляторов вообще нет файлов `pwmN`, сначала загрузите нужный драйвер
датчиков: `sudo sensors-detect` из пакета `lm-sensors`.

> Приложение всегда работоспособно: если управляемых вентиляторов не найдено
> (виртуальная машина, контейнер), запускается встроенный **симулятор** с
> тепловой моделью — можно посмотреть интерфейс командой `coolcontrol --demo`.

---

## Лицензия

MIT — см. [`LICENSE`](../LICENSE).
