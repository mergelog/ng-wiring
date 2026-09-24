import path from 'node:path';
import type ts from 'typescript';
import type { AnalysisContext } from '../../workspace/context.js';
import type { MazeEdge } from './index.js';

// A received code edge is usable only when the local Program resolves the
// target class at the reported call/property. The ngmaze AST is never shared.
export function verifyCodeEdge(context: AnalysisContext, edge: MazeEdge): boolean {
  if (edge.location.precision !== 'exact') return false;
  const t = context.toolchain.typescript;
  const absolute = path.resolve(context.workspaceRoot, edge.location.file);
  if (!context.sourceFiles.includes(absolute)) return false;
  const source = context.program.getSourceFile(absolute);
  if (!source) return false;
  if (edge.location.line < 1 || edge.location.line > source.getLineStarts().length || edge.location.column < 1) return false;
  const start = source.getPositionOfLineAndCharacter(edge.location.line - 1, edge.location.column - 1);
  if (start < 0 || start >= source.end) return false;
  const line = source.getLineAndCharacterOfPosition(start);
  if (line.line + 1 !== edge.location.line || line.character + 1 !== edge.location.column) return false;
  const targetMarker = edge.to.lastIndexOf('#');
  const targetFile = targetMarker > 0 ? path.resolve(context.workspaceRoot, edge.to.slice(0, targetMarker)) : '';
  const targetName = edge.to.slice(targetMarker + 1);
  if (!targetFile || !context.sourceFiles.includes(targetFile)) return false;
  const enclosing: ts.Node[] = [];
  const find = (node: ts.Node): void => {
    if (node.getStart(source) > start || node.end <= start) return;
    enclosing.push(node);
    t.forEachChild(node, find);
  };
  find(source);
  const candidate = [...enclosing].reverse().find(node => t.isCallExpression(node) || t.isPropertyAssignment(node));
  if (!candidate) return false;
  let found = false;
  const inspect = (node: ts.Node): void => {
    if (t.isIdentifier(node)) {
      let symbol = context.checker.getSymbolAtLocation(node);
      if (symbol?.flags && symbol.flags & t.SymbolFlags.Alias) symbol = context.checker.getAliasedSymbol(symbol);
      if (symbol?.declarations?.some(declaration => t.isClassDeclaration(declaration) &&
        declaration.name?.text === targetName && path.resolve(declaration.getSourceFile().fileName) === targetFile)) found = true;
    }
    t.forEachChild(node, inspect);
  };
  inspect(candidate);
  return found;
}
