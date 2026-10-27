# 3D FEM 円筒共振器：検証済みデータ

AWS Palace の3D Maxwell固有値解析を GitHub Actions 上で実行した結果です。

- 元の解析実行: https://github.com/go-itami/palace/actions/runs/40414950381
- 検証修正後の再検証: https://github.com/go-itami/palace/actions/runs/40512857641
- 元の実行ではビルドと解析は成功し、検証処理が「出力は必ず3モード」という誤った仮定で失敗しました。修正後は最低3モードを照合します。
- 半径27.4 mm、高さ54.8 mm、比誘電率2.08、誘電正接0.0004、完全導体境界。
- 2次・4次FEMの最低3モードすべてが周波数誤差1%未満、Q値誤差1%未満。

| FEM次数 | モード | 周波数 GHz | 理論値 GHz | 誤差 % |
|---|---|---|---|---|
|2|1|2.9050767|2.9036050|0.05068|
|2|2|2.9266022|2.9222120|0.15024|
|2|3|2.9266022|2.9222120|0.15024|
|4|1|2.9047696|2.9036050|0.04011|
|4|2|2.9228552|2.9222120|0.02201|
|4|3|2.9228552|2.9222120|0.02201|

全モードのQ値は約2500です。詳細数値は `verification_results.json` を参照。

## 3D電磁界を見る

`cavity-verification.zip` を展開し、ParaView 5.12.1で
`examples/cylinder/postpro/verification_p4/paraview/eigenmode/eigenmode.pvd`
を開きます。E_real / E_imag / B_real / B_imag を選択し、各モードを切り替えてください。
ZIPには元のCSV、設定、ログ、メッシュのハッシュ、ソルバーのコミット情報も含まれます。
ZIPは元のActions artifactを変更せず保存したもので、検証JSONは別ファイルです。

## 再実行

Actions → EM cavity verification → Run workflow。
`source_run_id` を空欄にするとビルドから新たに解析します。
既存artifactの検証のみならそのrun IDを指定します（Actionsのartifact保存期限は30日）。
ローカル検証はリポジトリ直下で以下を実行できます。

```sh
python3 scripts/verify_cavity.py path/to/verification_p2/eig.csv path/to/verification_p4/eig.csv
```

今回の検証範囲は円筒共振器の固有モードです。HFSSとの比較、任意CADのGUI、DB・AI代理モデルは未実装です。
この小規模モデルの解析時間を、大規模モデルの計算時間に一般化できません。
