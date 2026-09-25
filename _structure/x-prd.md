まずは設計から。
実現可否があると思うので、まずそこから検討してください

# Angular22対象プロジェクトの解析モジュールを作成

末端の子コンポーネントでui操作が関わるものから
末端の親コンポーネントまでの経路を算出して遷移資料を作成するツールを作成する

## 経緯

以下の問題があるため新規でプラグインを作成する

- スキルの /bulletin では正確さを担保できない。AI任せなのでコストもかかる。また、もっとコードリーディングを前提とした詳細が欲しい
- ng-maze は便利だがロジックの詳細までは追えていない。これはこのままにし、サブモジュール的な扱いとし、今の挙動を維持したい

## 作成場所
ng-wiring
ng-wiring/_structure/x-structure.md

## 概要
コンポーネント遷移で、どのようにデータを渡しているかも記載する。
また、コンポーネントの親子関係以外でも他クラスを参照する以下のような場合も作成する資料の流れに記載する。
サービス間の繋がりで重要なもの、主に以下
- API通信
- API通信に携わるModelインターフェイス読み込み
- 状態管理の元となるModelインターフェイス読み込み

但し、繊維資料の主役はあくまで コンポーネント であるため
コンポーネントとサービス間のつながりは同列にしない。

## ツールの使用

解析には
ast-grep、TypeScript Compiler API、 ts-morph
などを使用して効率化を検討する。
但し、インストールの敷居が低いものを使用する。特にOS自体にインストールが必要なものは使用したくない（aptなど）
※OS自体にインストールして費用対効果が爆上がりする案があれば相談してください。

尚、SKILLにある ng-maze も参考にし、流用できる実装は流用して良い

## 入力

npx github/mergelog/ng-wiring {data-idなど部品を特定できる指定部分} {chrome devtoolから取得した selector}

コマンド例:
```
npx ng-wiring 'data-id="targetInput"' 'body > app-root > app-shell > app-search > input'
```

上記の例の元となった要素のコピー
```html
<input _ngcontent-ng-c2747600649="" data-id="targetInput" placeholder="Type to search" class="">
```

※data-id="targetInput" のところはこのプロジェクト固有かもしれないので key and value の指定にしている。難易度は高いと思うので費用対効果により "data-id"固定でも良い。その場合は、data-idの付いていない部品があるか一旦調査してください

## 出力

### 出力ファイル名

ngwi-{処理名}-{YYMMDD.HHMMSS}.md

処理名は、以下例の場合、SearchComponent.data-id="targetInput"

例: ngwi-SearchComponent.data-id="targetInput"-260924.130024.md

### 出力例

以下が最終出力例です。さらに案があれば提案してください

````md
# SearchComponent.data-id="targetInput"

## {連番}: CatalogAssetsTableComponent

- in:
  - class: readonly assets = input<readonly CatalogAsset[]>([]); [▶️](src/app/webapp-common/shared/ui-components/inputs/search/search.component.ts#123)
  - html: (input)="enableSearchOnSubmit()? validateValue() :onValueChange()" [▶️](src/app/webapp-common/shared/ui-components/inputs/search/search.component.html#21)

- service:

  - NgRX.effect: API regist Logic [▶️](リンク)
    ```ts
    {主要な処理}
    ```
    - interface: [▶️](リンク)
    ```ts
      {主要なインターフェース}
    ```

- out:
  - class: {inと同じような感じだが、次の連番と被らない情報のみ記載}
````
