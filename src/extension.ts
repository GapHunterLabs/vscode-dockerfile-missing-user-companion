import * as vscode from 'vscode';
import { scanDockerfile } from './dockerfile';
import { recordHit } from './reviewPrompt';

let diagnostics: vscode.DiagnosticCollection;

function basename(uri: vscode.Uri): string {
  const path = uri.path;
  return path.slice(path.lastIndexOf('/') + 1);
}

/** A document is a Dockerfile when VS Code has assigned it the
 * `dockerfile` language id, or its name looks like one: `Dockerfile`,
 * `Dockerfile.<suffix>`, `<prefix>.Dockerfile`, or `Containerfile`
 * (Podman's equivalent). Name-based matching so it works even before a
 * language extension tags the file. */
function isDockerfile(document: vscode.TextDocument): boolean {
  if (document.languageId === 'dockerfile') return true;
  const name = basename(document.uri);
  return (
    name === 'Dockerfile' ||
    name === 'Containerfile' ||
    name.startsWith('Dockerfile.') ||
    name.endsWith('.Dockerfile')
  );
}

function refresh(context: vscode.ExtensionContext, document: vscode.TextDocument): void {
  if (!isDockerfile(document)) {
    diagnostics.delete(document.uri);
    return;
  }

  const violations = scanDockerfile(document.getText());
  const result = violations.map((violation) => {
    const line = violation.line - 1;
    const range = new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER);
    const diagnostic = new vscode.Diagnostic(range, violation.message, vscode.DiagnosticSeverity.Warning);
    diagnostic.source = 'Dockerfile Missing USER Companion';
    diagnostic.code = violation.kind;
    recordHit(context, `${document.uri.toString()}:${violation.line}`);
    return diagnostic;
  });
  diagnostics.set(document.uri, result);
}

export function activate(context: vscode.ExtensionContext): void {
  diagnostics = vscode.languages.createDiagnosticCollection('dockerfileMissingUserCompanion');
  context.subscriptions.push(diagnostics);

  vscode.workspace.textDocuments.forEach((doc) => refresh(context, doc));

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => refresh(context, doc)),
    vscode.workspace.onDidSaveTextDocument((doc) => refresh(context, doc)),
    vscode.workspace.onDidCloseTextDocument((document) => diagnostics.delete(document.uri)),
  );
}

export function deactivate(): void {
  diagnostics?.dispose();
}
