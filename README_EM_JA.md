# 3D電磁界シミュレータ：実行ガイド

このリポジトリはAWSのオープンソース3D FEM電磁界ソルバー **Palace** をフォークしたものです。ソルバー本体・メッシュ・解析例を含み、専用の `EM cavity verification` ワークフローでCPUによる3D Maxwell固有値解析を実行します。HFSS風のCAD GUIやAI代理モデルはまだ実装していません。

## ブラウザから実行

1. [Actions → EM cavity verification](https://github.com/go-itami/palace/actions/workflows/em-cavity.yml) を開きます。
2. **Run workflow** → **main** → **Run workflow** を選択します。
3. `cavity` ジョブでビルド・解析・検証が順に実行されます。初回は依存ライブラリのビルドにも時間がかかります。
4. 成功した実行の **Summary** にFEM周波数・理論周波数・相対誤差・Qの表が出ます。
5. **Artifacts → cavity-verification** をダウンロードします。保存期限は30日なので、継続利用するデータは別途保管してください。

AWSアカウントや手元PCの起動は不要です。計算はGitHubのUbuntu runnerで行います。上流から継承したCIにはAWS専用runnerを要求するものがあります。この検証には上記専用ワークフローを使ってください。

## 検証する物理系

|項目|設定|
|---|---|
|形状|円筒：半径27.4 mm、高さ54.8 mm|
|媒質|比誘電率2.08、比透磁率1、誘電正接0.0004|
|境界|全壁面PEC|
|メッシュ|`examples/cylinder/mesh/cylinder_hex.msh`（曲面六面体）|
|有限要素|Maxwell用ベクトル有限要素、次数2と4|
|解析|2 GHzより上の最低3固有モード、2 MPIプロセス|
|照合値|TM010: 2.903605 GHz、TE111の縮退対: 2.922212 GHz|
|誘電体損失Q|1/tanδ = 2500|
|合格条件|各モードの周波数・Qが理論値に対して1%未満の誤差|

次数比較は初期確認です。任意形状の精度保証には、メッシュ収束・次数収束・境界条件の確認を追加してください。縮退モードは固有ベクトルが回転し得るので、HFSSとの比較でモード番号だけを対応付けないでください。

## 出力

- `verification_p2.json`, `verification_p4.json`: 実際に使用した設定。
- `verification_p2.log`, `verification_p4.log`: 解析ログ。
- `postpro/verification_p*/eig.csv`: 複素固有周波数、Q、固有値残差。
- `postpro/verification_p*/`: 電磁界・エネルギー等の出力。ParaView形式のファイルを含みます。
- `verification_results.json`: 次数・モード別の周波数、理論値、相対誤差、Q。
- `verification_metadata.json`: ソースcommit、メッシュSHA-256、寸法、材料、HFSS比較の有無。
- `CMakeCache.txt`: ビルド設定。

ParaViewでは出力ディレクトリ内の `.pvd` を開き、Applyを押して電界のMagnitudeや各成分を選択します。固有モードの振幅は規格化されており、実際の励振電力に対応する絶対電界ではありません。

## ローカルでビルドして実行（Ubuntu 24.04 / WSL2）

```bash
git clone https://github.com/go-itami/palace.git
cd palace
sudo apt-get update
sudo apt-get install -y build-essential gfortran cmake openmpi-bin libopenmpi-dev libopenblas-serial-dev liblapack-dev libunwind-dev zlib1g-dev pkg-config
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$PWD/install" -DPALACE_WITH_LIBXSMM=OFF -DPALACE_WITH_MAGMA=OFF -DPALACE_WITH_SUNDIALS=OFF
cmake --build build --parallel 2
export OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1
cd examples/cylinder
../../install/bin/palace -np 2 cavity_pec.json
```

このコマンドは上流の15モード・次数4の例を実行します。専用ワークフローと同じ3モードの検証を再現するには、ダウンロードした `verification_p2.json` と `verification_p4.json` をこのディレクトリに置き、入力ファイル名を置き換えて実行してください。ビルド済みバイナリはOS・CPU・MPIに依存します。

## HFSS比較とAI高速化への次段階

現在の検証は解析解との比較です。HFSS実行・HFSS比較・学習DB・AI推論の高速化実証は未実施です。

次は同一寸法・材料・PEC境界でHFSS固有値解析を行い、周波数、Q、規格化電磁界、収束履歴、自由度、実行時間を対にして保存します。幾何形状ID、単位、ソルバー版、メッシュ設定、計算機仕様も記録します。縮退部分空間・位相・正規化を揃えて場を比較する必要があります。

その後、形状・材料パラメータを掃引し、未学習形状で精度と推論時間を評価します。学習範囲外はfull-wave FEMへ戻す設計とし、任意の大規模解析を一瞬で解けるという主張は実測で検証するまで行いません。
