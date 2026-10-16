# 本機測試帳號與繁體中文補丁

## adam 的存檔與一次性解鎖

雙擊 `index.html`／`dev.html` 時，遊戲使用原瀏覽器的 localStorage：

- `ps.accounts`：本機帳號資料（密碼以雜湊保存）。
- `ps.save.adam`：adam 的遊戲進度。
- `ps.session`：目前登入的本機帳號。

這些資料不在專案資料夾內。**請用建立帳號時的同一個瀏覽器，開啟原本同一路徑、同一個 HTML 檔案**；換瀏覽器、移動檔案或把 `index.html` 換成 `dev.html`，可能會讀到不同的儲存空間。`http://localhost` 則是另一個來源，也不共用這份資料。

本次已啟用 `js/data/local-test-profile.js` 的一次性測試設定。重新載入原遊戲，登入 adam（或恢復原有登入狀態）後會自動套用：

- 全部 966 隻現有角色。
- 所有實際有 shiny 圖檔的角色之 shiny 版本。
- 每隻角色的永久升級全部升到程式允許的最高級。
- 金幣至少 **999,999,999**。
- 單抽券、十連券各至少 **99,999,999**。

遊戲沒有金幣或券的「滿級」上限，所以使用大量有限整數，而非 `Infinity`。現有數量若更高則保留。戰績、通關、成就不會被直接改成虛構的紀錄。

此補丁限 `file://`、本機儲存模式、非訪客且帳號名稱為 adam；其他帳號和 Firebase 存檔不會套用。沒有在原始碼內保存密碼，也不會重新建立／覆寫帳號。

套用前會備份原存檔到同一個 localStorage 的：

```text
ps.backup.adam.adam-full-unlock-v1
```

`save.localTestPreset` 記錄套用版本；同一版本只執行一次，所以花掉資源或卸下道具後不會每次登入又重設。若需要再補一次資源，可在設定檔更換 `id` 後重新打包。要停用補丁，將 `enabled` 改成 `false` 並重新打包。

如需還原，先停用並重新打包，再在**原遊戲頁面**的開發者工具 Console 執行以下程式；帳號密碼不受影響：

```js
const backup = localStorage.getItem('ps.backup.adam.adam-full-unlock-v1');
if (!backup) throw new Error('找不到 adam 的解鎖前備份');
JSON.parse(backup); // 先確認內容是合法 JSON
localStorage.setItem('ps.save.adam', backup);
location.reload();
```

## 填寫繁體中文翻譯

編輯 `locales/zh-TW.json`。所有鍵使用英文，值預留空字串，例如：

```json
{
  "Back": "",
  "Bulbasaur": "",
  "Level {x}": ""
}
```

填好後可以變成：

```json
{
  "Back": "返回",
  "Bulbasaur": "妙蛙種子",
  "Level {x}": "等級 {x}"
}
```

空字串代表沿用英文；沒有列入既有英文詞庫的西班牙文文字，仍需先在 `js/data/lang-en.js` 補上英文對照。模板涵蓋既有英文詞庫及現有寶可夢名稱，不會自動把漏列的原文翻成英文。

注意事項：

- 保留英文鍵，只填右側的值。
- 保留 `{x}` 的數量與對應順序，遊戲會代入數字／名稱；編譯時會檢查數量。
- 以 UTF-8 儲存合法 JSON；字串內的雙引號須寫成 `\"`，最後一項不能有多餘逗號。
- 玩家自訂名稱等 `translate="no"` 區塊維持原文。
- 修改 JSON 後要執行下列轉換；`js/data/lang-zh-TW.js` 是產物，請不要直接編輯。

在專案根目錄執行（需要 Node.js；完整打包另需 npm/npx）：

```powershell
# 只更新翻譯檔，直接測試 dev.html
node tools/build_locale.js

# 正式入口 index.html：會自動先編譯翻譯 JSON
node tools/build.js
```

目前這個 Codex 環境另備有專案內的 npm 快取工具。若 `node tools/build.js` 提示找不到 `npx.cmd`，可在同一個 PowerShell 視窗先設定：

```powershell
$env:PATH = "$PWD\tools\cache\npm-runtime;$env:PATH"
$env:npm_config_cache = "$PWD\tools\cache\npm-cache"
node tools/build.js
```

`tools/cache` 是本機快取，不包含在分享的補丁內；其他電腦請安裝含 npm/npx 的 Node.js。

重新整理遊戲，在 **Settings → Graphics → 繁體中文** 切換（西文介面為 Ajustes → Gráficos）。選擇會保存在同一瀏覽器來源的 `ps.lang`，語言代碼為 `zh-TW`。尚未填翻譯時顯示英文是預期行為。

若未來遊戲增加英文詞條或角色，執行下列指令補入新鍵；既有翻譯與自行新增的鍵都會保留：

```powershell
node tools/build_locale.js --sync
node tools/build_locale.js --check
```

要分享繁中補丁，至少保留 `locales/zh-TW.json`、產生的 `js/data/lang-zh-TW.js`，以及本次 i18n／設定畫面／腳本載入／打包流程的修改；單獨複製 JSON 到未支援繁中的原版遊戲不會生效。只修改翻譯時，重新打包產生的 `js/app.min.js`、`index.html`、`version.json` 應一起更新。若也提供英文網站入口，依專案原流程再執行 `node tools/export_data.js` 與 Python 3.12 以上的 `tools/make_seo_pages.py`。

測試帳號設定是這個本機工作目錄專用。分享或發布給其他人之前，可將 `js/data/local-test-profile.js` 的 `enabled` 設為 `false` 再打包。
