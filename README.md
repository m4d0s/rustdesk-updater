# Rustdesk Updater (RustDesk Server in OpenWrt)
Удобная утилита c LuCi интерфейсом для подтягивания hbbr и hbbs пакетов для rustdesk-server на OpenWrt системах
Идёт как дополнение к пакету `luci-app-rustdesk-server` для контроля актуальности файлов и автоматического обновления

## Проект на стадии альфа-тестирования!
Могут быть неточности, баги или некорректное отображение интерфейса, все нужные исправления отправляйте в Issues или Pull Requests если есть уже готовые наработки
Сейчас он проверяется на версии OpenWrt 25.12, роутере Cudy TR3000 256mb v1
В ближайшее время сделаю также .ipk для более старых версий, если на них также есть `luci-app-rustdesk-server`

### AI Generated
Создано с помощью ChatGPT, проверено человеком

## Сборка вручную / OpenWrt SDK

Для самостоятельной сборки пакета `luci-app-rustdesk-updater` под OpenWrt 25.x
требуется исходный код OpenWrt 25.x либо **OpenWrt SDK** (`openwrt-sdk-*` для
целевой архитектуры) — дополнительные файлы SDK при необходимости готовятся
отдельно и не входят в репозиторий.

Сборка:

```sh
make package/luci-app-rustdesk-updater/compile
```

или `make package/luci-app-rustdesk-updater/openwrt`.
