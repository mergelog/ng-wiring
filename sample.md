# fooAction の処理遷移

## fooAction の遷移

- 13. [▶️:h:V](../src/app/foo/foo-panel.component.html#L10) &lt;ng-template&gt;:10
- 12. [▶️:@:C](../src/app/foo/foo-panel.component.html#L11) @if (fooData):11
- 11. [▶️:@:C](../src/app/foo/foo-panel.component.html#L12) @if (expanded || currentTab === 'bar'):12
- 10. [▶️:h:V](../src/app/foo/foo-panel.component.html#L13) &lt;app-bar-section [editable]="editable()"&gt;:13
- 09. [▶️:@:C](../src/app/shared/bar-section/bar-section.component.html#L20) @if (inEditMode() &amp;&amp; !disableInEditMode()):20
- 08. [▶️:@:C](../src/app/shared/bar-section/bar-section.component.html#L21) @if (!hideFooButton()):21
- 07. [▶️:h:V](../src/app/shared/bar-section/bar-section.component.html#L22) &lt;button data-id="FooButton"&gt;:22
- 06. [▶️:h:D](../src/app/shared/bar-section/bar-section.component.html#L23) (click) !disableSave() &amp;&amp; !saving() &amp;&amp; saveSection():23
- 05. [▶️:C:D](../src/app/shared/bar-section/bar-section.component.ts#L40) this.saveClicked.emit():40
- 04. [▶️:h:D](../src/app/foo/foo-panel.component.html#L16) (saveClicked) fooForm.valid &amp;&amp; saveFoo():16
- 03. [▶️:D:D](../src/app/foo/foo-panel.component.ts#L60) this.store.dispatch(fooActions.saveFoo({ data: this.fooForm.getRawValue() })):60
- 02. [▶️:E:D](../src/app/foo/state/foo.effects.ts#L30) saveFoo$（ofType(fooActions.saveFoo) → fooApi.saveFoo(action.data)）:30
- 01. [▶️:S:A](../src/app/foo/services/foo-api.service.ts#L15) POST /api/foo:15

## 状態から表示

- [fooData.set(data) で状態を明示更新](../src/app/foo/foo-panel.component.ts#L70) → [fooLabel（computed・依存する fooData の変更後、読取時に再計算）](../src/app/foo/foo-panel.component.ts#L25) → [fooLabel() を表示](../src/app/foo/foo-panel.component.html#L5)
- 操作: 入力と保存ボタンの click は別操作。output は保存メソッドが emit した場合に届く。

## 凡例

1個目（種別）

- `:h` html
- `:@` 制御フロー
- `:C` コンポーネントクラスts
- `:D` ディスパッチ
- `:E` エフェクト
- `:S` サービス

2個目（関係）

- `:V` 表示配置
- `:C` 条件分岐
- `:D` データ受け渡し
- `:A` API通信
