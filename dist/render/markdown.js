import path from 'node:path';
import { isProvenFalse, weakestConfidence } from '../model/conditions.js';
import { activeGaps } from '../model/gaps.js';
import { displayGroupLabels, displayGroupOf, renderCondition, renderSentence } from './sentences.js';
import { escapeInline, relativeLinkTarget } from './text.js';
const number = (index) => String(index + 1).padStart(2, '0');
const listOr = (values, empty) => values.length ? values.map(escapeInline).join(', ') : empty;
/**
 * §8 the Markdown report. Every relation comes from the closed sentence table, every sentence ends with
 * its evidence link and the conditions or unresolved reasons it needs, and nothing here re-derives
 * confidence or coverage: those are read from the model as the single source (§5).
 */
export function renderMarkdown(input) {
    const { report } = input;
    const platform = input.platform ?? path;
    const problems = [];
    const out = [];
    const evidence = new Map(report.evidence.map(item => [item.id, item]));
    const nodes = new Map(report.nodes.map(node => [node.id, node]));
    const edges = new Map(report.edges.map(edge => [edge.id, edge]));
    const conditions = new Map(report.conditions.map(condition => [condition.id, condition]));
    const rendered = new Set();
    const link = (id) => {
        const item = evidence.get(id);
        if (!item) {
            problems.push(`Evidence ${id} is missing from the report`);
            return `（根拠 ${escapeInline(id)} は記録にない）`;
        }
        const text = escapeInline(`${item.file}:${item.startLine}`);
        const absolute = platform.resolve(report.context.workspaceRoot, item.file);
        const target = relativeLinkTarget(input.outputDir, absolute, platform);
        // §8 a link that cannot be made relative is written as absolute text with a diagnostic, never guessed.
        if (!target) {
            problems.push(`No relative source link from ${input.outputDir} to ${absolute}`);
            return `${text}（相対リンク不可・絶対パス ${escapeInline(absolute)}）`;
        }
        return `[${text}](${target}#L${item.startLine})`;
    };
    const links = (ids) => ids.length ? ids.map(link).join(' , ') : '根拠なし';
    const labelOf = (id) => {
        const node = nodes.get(id);
        if (!node) {
            problems.push(`Node ${id} is missing from the report`);
            return { name: id, file: null };
        }
        const symbol = node.role === 'definition' ? node.id.slice('def:'.length)
            : node.definitionId ? node.definitionId.slice('def:'.length) : null;
        // §8 the declaring path is what tells two same-named classes apart, so it comes before the use site.
        const file = (symbol && symbol.includes('#') ? symbol.slice(0, symbol.indexOf('#')) : null)
            ?? node.occurrence?.span?.file ?? evidence.get(node.evidenceIds[0] ?? '')?.file ?? null;
        const explicit = node.details.label?.value ?? node.details.name?.value ?? null;
        if (explicit)
            return { name: explicit, file };
        if (symbol) {
            const hash = symbol.lastIndexOf('#');
            return { name: hash >= 0 ? symbol.slice(hash + 1) : symbol, file };
        }
        // A use site with neither a label nor a declaration is named by its kind and where it was read.
        const first = evidence.get(node.evidenceIds[0] ?? '');
        return { name: first ? `${node.kind} @${first.file}:${first.startLine}` : node.kind, file };
    };
    // §8 sections run from the selected child to the root, one per use site, numbered from 01.
    const sectionIds = [];
    for (const item of report.paths)
        for (const id of item.occurrenceIds)
            if (!sectionIds.includes(id))
                sectionIds.push(id);
    const sectionIndex = new Map(sectionIds.map((id, index) => [id, index]));
    const labels = new Map(sectionIds.map(id => [id, labelOf(id)]));
    const filesByName = new Map();
    for (const label of labels.values()) {
        const known = filesByName.get(label.name) ?? new Set();
        if (label.file)
            known.add(label.file);
        filesByName.set(label.name, known);
    }
    /** §8 two sections with the same class name are told apart by the path shown next to the name. */
    const title = (id) => {
        const label = labels.get(id) ?? labelOf(id);
        const ambiguous = (filesByName.get(label.name)?.size ?? 0) > 1;
        return ambiguous && label.file ? `${escapeInline(label.name)}（${escapeInline(label.file)}）` : escapeInline(label.name);
    };
    const reference = (id) => {
        const index = sectionIndex.get(id);
        return index === undefined ? title(id) : `節 ${number(index)} ${title(id)}`;
    };
    const edgeLine = (id) => {
        const edge = edges.get(id);
        if (!edge) {
            problems.push(`Edge ${id} is missing from the report`);
            return `- 未知の辺 ${escapeInline(id)}`;
        }
        rendered.add(id);
        const sentence = renderSentence(edge.kind, edge.details);
        const condition = renderCondition(conditions, edge.conditionId);
        const tail = [`${sentence.text}。`, `確定度: ${edge.confidence}。`, `出典: ${edge.origin}。`];
        if (condition)
            tail.push(`条件: ${condition}。`);
        if (sentence.unresolved.length)
            tail.push(`未解決: ${sentence.unresolved.map(escapeInline).join(' / ')}。`);
        tail.push(`根拠: ${links(edge.evidenceIds)}`);
        return `- \`${edge.kind}\`（${displayGroupLabels[displayGroupOf[edge.kind]]}）${tail.join(' ')}`;
    };
    const excluded = new Set(report.edges.filter(edge => isProvenFalse(conditions, edge.conditionId)).map(edge => edge.id));
    const inPaths = new Set(report.paths.flatMap(item => item.edgeIds));
    const inOperations = new Set(report.operations.flatMap(item => item.edgeIds));
    const sectionEdges = new Map();
    const pathOnlyEdges = new Set();
    for (const edge of report.edges) {
        if (!inPaths.has(edge.id) || excluded.has(edge.id))
            continue;
        const owner = sectionIndex.has(edge.to) ? edge.to : sectionIndex.has(edge.from) ? edge.from : null;
        if (owner === null) {
            pathOnlyEdges.add(edge.id);
            continue;
        }
        const list = sectionEdges.get(owner);
        if (list)
            list.push(edge.id);
        else
            sectionEdges.set(owner, [edge.id]);
    }
    const target = report.query.target;
    const targetText = target.kind === 'attribute' ? `${target.name}="${target.value}"` : `${target.file}:${target.line}`;
    const selected = report.query.candidates.find(candidate => candidate.id === report.selection.candidateId);
    const filters = Object.entries(report.query.filters).filter(([, value]) => value !== null)
        .map(([key, value]) => `${key}=${value}`);
    const pathConfidence = weakestConfidence(report.paths.map(item => item.confidence));
    // §8 the head of the report: target and owner, project, snapshot and applied settings, the candidate id,
    // the selected display path and root, the events, confidence and coverage, and the blocking unknowns.
    out.push(`# ng-wiring 経路資料: ${escapeInline(input.heading)}`, '');
    out.push(`- status: **${report.status}**${report.status === 'partial' ? '（未解決・未検出を含む。詳細は「診断と制限」）' : ''}`);
    out.push(`- 対象: ${escapeInline(targetText)}（${link(report.selection.element.evidenceId)}）`);
    out.push(`- 所有者: ${escapeInline(report.selection.ownerId)}`);
    out.push(`- クエリ: ${escapeInline(report.query.raw)} / 絞り込み: ${filters.length ? listOr(filters, '') : 'なし'}`);
    out.push(`- project: ${escapeInline(report.context.projectName ?? '（未指定）')}（${report.context.projectType}）` +
        ` / tsconfig: ${escapeInline(report.context.tsconfig)} / 設定ハッシュ: \`${escapeInline(report.context.configHash)}\``);
    out.push(`- toolchain: TypeScript ${escapeInline(report.context.toolchain.typescript)}` +
        ` / @angular/compiler ${escapeInline(report.context.toolchain.angularCompiler)}` +
        ` / ngmaze ${escapeInline(report.context.toolchain.ngmaze)}`);
    out.push(`- entry: ${listOr(report.context.entry, '（未確定）')}${report.context.entryUnknown ? '（bootstrap は推測しない）' : ''}`);
    out.push(`- 未適用の設定: ${listOr(report.context.unapplied, 'なし')}`);
    out.push(`- 走査から除外: ${listOr(report.context.excluded, 'なし')}`);
    out.push(`- snapshot: \`${escapeInline(report.snapshotId)}\` / 解析開始: ${escapeInline(report.generatedAt)}` +
        ` / ng-wiring ${escapeInline(report.toolVersion)} / schema ${escapeInline(report.schemaVersion)}`);
    out.push(`- 候補 ID: \`${escapeInline(report.selection.candidateId)}\`` +
        `（分類 ${escapeInline(selected?.class ?? '不明')}）`);
    out.push(`- 候補一覧: ${report.query.candidates.length} 件（列挙 ${report.query.enumerationComplete ? '完結' : '打ち切り'}）`);
    out.push(`- 表示経路: ${report.paths.length} 件（終端 ${listOr(report.paths.map(item => item.end), 'なし')}）`);
    out.push(`- route: ${report.selection.routeIds.length ? report.selection.routeIds.map(reference).join(', ') : 'なし'}`);
    out.push(`- bootstrap: ${report.selection.bootstrapId ? reference(report.selection.bootstrapId) : '未到達'}`);
    out.push(`- イベント: ${listOr(report.selection.events, 'なし')}`);
    out.push(`- confidence: 表示経路 ${pathConfidence}` +
        `${report.operations.map(item => ` / ${escapeInline(item.event)} ${item.confidence}`).join('')}`);
    out.push(`- coverage: 全体 ${report.coverage.overall} / 表示経路 ${report.coverage.paths}` +
        `${report.coverage.events.map(item => ` / ${escapeInline(item.event)} ${item.coverage}`).join('')}`);
    out.push(`- ファイル名元文字列: ${escapeInline(input.fileNameSource)}`);
    if (report.coverage.reasons.length) {
        out.push('- 重要な未解決理由:');
        for (const reason of report.coverage.reasons.slice(0, 10))
            out.push(`  - ${escapeInline(reason)}`);
        if (report.coverage.reasons.length > 10) {
            out.push(`  - ほか ${report.coverage.reasons.length - 10} 件（「診断と制限」を参照）`);
        }
    }
    else
        out.push('- 重要な未解決理由: なし');
    out.push('');
    out.push('## 1. 表示経路', '');
    if (!report.paths.length)
        out.push('この探索では表示経路を確定できなかった。「診断と制限」の停止理由を参照。', '');
    report.paths.forEach((item, index) => {
        out.push(`### 経路 ${index + 1}`, '');
        out.push(`- 節: ${item.occurrenceIds.map(reference).join(' → ')}`);
        // §8 a cycle shows what it referred back to and that the walk was cut off; no root section is invented.
        out.push(`- 終端: ${item.end}${item.end === 'cycle' ? '（参照先で循環したため打ち切り）' : ''} — ${escapeInline(item.endReason)}`);
        out.push(`- confidence: ${item.confidence} / coverage: ${item.coverage}`);
        for (const reason of item.coverageReasons)
            out.push(`  - coverage 理由: ${escapeInline(reason)}`);
        out.push(`- 宣言元: ${item.declarationIds.length ? item.declarationIds.map(id => `${title(id)}（${links(nodes.get(id)?.evidenceIds ?? [])}）`).join(', ') : 'なし'}`);
        for (const id of item.edgeIds)
            if (pathOnlyEdges.has(id))
                out.push(edgeLine(id));
        out.push('');
    });
    out.push('## 2. コンポーネント節（子 → root）', '');
    sectionIds.forEach((id, index) => {
        const node = nodes.get(id);
        out.push(`### ${number(index)}. ${title(id)}`, '');
        out.push(`- 種別: ${node?.kind ?? '不明'} / 役割: ${node?.role ?? '不明'}`);
        out.push(`- 位置: ${links(node?.evidenceIds ?? [])}`);
        const definition = node?.definitionId;
        out.push(`- 宣言元: ${definition ? `${title(definition)}（${links(nodes.get(definition)?.evidenceIds ?? [])}）` : '同一節内'}`);
        const key = node?.occurrence;
        out.push(`- 挿入先: ${key?.insertion ? escapeInline(key.insertion) : 'なし'}` +
            ` / 投影先: ${key?.projection ? escapeInline(key.projection) : 'なし'}` +
            ` / route: ${key?.route ? escapeInline(key.route) : 'なし'}`);
        if (node?.role === 'boundary') {
            out.push(`- 追跡停止: ${escapeInline(node.details.reason?.value ?? '理由の記録なし')}`);
        }
        for (const edgeId of sectionEdges.get(id) ?? [])
            out.push(edgeLine(edgeId));
        out.push('');
    });
    if (!sectionIds.length)
        out.push('表示経路が確定しなかったため、番号付きの節は作らない。', '');
    out.push('## 3. イベント別の処理', '');
    if (!report.operations.length) {
        out.push(`この探索範囲では起点イベントからの処理を検出していない（対象イベント: ${listOr(report.selection.events, 'なし')}）。`, '');
    }
    for (const operation of report.operations) {
        out.push(`### ${escapeInline(operation.event)}`, '');
        out.push(`- 起点: ${reference(operation.eventId)} / リスナー: ${reference(operation.listenerId)}`);
        out.push(`- confidence: ${operation.confidence} / coverage: ${operation.coverage}`);
        for (const reason of operation.coverageReasons)
            out.push(`  - coverage 理由: ${escapeInline(reason)}`);
        for (const id of operation.edgeIds)
            if (!excluded.has(id))
                out.push(edgeLine(id));
        out.push('');
    }
    // §8 only the requests reached from this starting point are reported; nothing is claimed about the rest.
    const httpEdges = report.edges.filter(edge => !excluded.has(edge.id) &&
        (edge.kind === 'http-create' || edge.kind === 'http-consume'));
    out.push('### 通信', '');
    if (httpEdges.length) {
        out.push('この起点から検出した要求（再掲）:');
        for (const edge of httpEdges)
            out.push(edgeLine(edge.id));
    }
    else {
        out.push('この探索範囲で通信への接続は未検出。' +
            `coverage: 全体 ${report.coverage.overall}。` +
            `停止理由: ${listOr(report.paths.map(item => `${item.end}: ${item.endReason}`)
                .concat(report.diagnostics.filter(item => item.stopReason).map(item => item.stopReason)), 'なし')}。` +
            'アプリに通信が無いことを示すものではない。');
    }
    out.push('');
    out.push('## 4. 背景入力', '');
    const background = report.edges.filter(edge => !inPaths.has(edge.id) && !inOperations.has(edge.id) && !excluded.has(edge.id));
    if (background.length)
        for (const edge of background)
            out.push(edgeLine(edge.id));
    else
        out.push('選択した経路・イベントの外から入る関係は検出していない。');
    out.push('');
    out.push('## 5. 除外した枝', '');
    if (excluded.size) {
        for (const id of excluded) {
            out.push(edgeLine(id));
            const reasons = report.diagnostics.filter(item => item.relatedIds.includes(id))
                .map(item => `${item.code}: ${item.message}`);
            out.push(`  - 除外理由: ${listOr(reasons, '診断が見つからない')}`);
        }
    }
    else
        out.push('偽と証明できた枝はない。');
    out.push('');
    out.push('## 6. 診断と制限', '');
    out.push('### 診断', '');
    if (report.diagnostics.length) {
        for (const item of report.diagnostics) {
            out.push(`- [${item.severity}] ${escapeInline(item.code)}: ${escapeInline(item.message)}` +
                `${item.stopReason ? ` 停止理由: ${escapeInline(item.stopReason)}。` : ''}` +
                ` 根拠: ${item.evidenceIds.length ? links(item.evidenceIds) : 'ソース位置なし'}`);
        }
    }
    else
        out.push('診断なし。');
    out.push('');
    out.push('### coverage', '');
    out.push(`- 全体: ${report.coverage.overall} / 表示経路: ${report.coverage.paths}`);
    for (const item of report.coverage.events)
        out.push(`- イベント ${escapeInline(item.event)}: ${item.coverage}`);
    for (const reason of report.coverage.reasons)
        out.push(`- 理由: ${escapeInline(reason)}`);
    out.push('');
    // §8 a gap ng-wiring filled in keeps its record but leaves the active missing list.
    const active = activeGaps(report.coverage.gaps);
    const filled = report.coverage.gaps.filter(gap => gap.resolvedBy);
    const globalUnknown = report.coverage.gaps.filter(gap => gap.relation === 'global-unknown' && !gap.resolvedBy);
    const gapLine = (gap) => `- ${escapeInline(gap.code)}: ${escapeInline(gap.message)}` +
        `${gap.owner ? `（owner ${escapeInline(gap.owner)}）` : ''}`;
    out.push('### 未検出範囲', '');
    out.push('関連する未検出:');
    if (active.length)
        for (const gap of active)
            out.push(gapLine(gap));
    else
        out.push('- なし');
    out.push('', 'ng-wiring が補完した未検出（原記録を残す。active な欠落には数えない）:');
    if (filled.length) {
        for (const gap of filled) {
            out.push(`${gapLine(gap)} 補完: ${escapeInline(gap.resolvedReason ?? '根拠の記録なし')}` +
                `（${escapeInline(gap.resolvedBy ?? '')}、関連 ${gap.relation}）`);
        }
    }
    else
        out.push('- なし');
    out.push('', '解析全体の未検出範囲:');
    if (globalUnknown.length) {
        for (const gap of globalUnknown)
            out.push(`- ${escapeInline(gap.code)}: ${escapeInline(gap.message)}`);
    }
    else
        out.push('- なし');
    out.push('', '対象外の未検出（コード別件数）:');
    if (report.coverage.gapCounts.length) {
        for (const item of report.coverage.gapCounts)
            out.push(`- ${escapeInline(item.code)}: ${item.count} 件`);
    }
    else
        out.push('- なし');
    out.push('');
    out.push('### 制限', '');
    if (report.limits.applied.length) {
        for (const item of report.limits.applied) {
            out.push(`- ${escapeInline(item.name)}: 上限 ${item.limit} / 停止 ${item.stops} / 未探索 ${item.unexplored}`);
        }
    }
    else
        out.push('- 適用した上限なし');
    for (const item of report.limits.truncations) {
        out.push(`- 打ち切り ${escapeInline(item.limit)}: ${escapeInline(item.reason)} 根拠: ${item.evidenceIds.length ? links(item.evidenceIds) : 'ソース位置なし'}`);
    }
    out.push('');
    for (const edge of report.edges) {
        if (!rendered.has(edge.id))
            problems.push(`Edge ${edge.id} (${edge.kind}) was not rendered`);
    }
    return { text: `${out.join('\n')}\n`, edgeIds: [...rendered].sort(), problems };
}
