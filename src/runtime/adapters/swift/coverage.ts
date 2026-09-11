import type {SwiftScan} from './scan';

/** Explain construction limits separately from the source-backed navigation map. */
export function swiftPreviewBlocker(scans: SwiftScan[], file: string, symbol: string) {
  const scan = scans.find(scan => scan.path === file);
  const view = scan?.declarations.find(view => view.symbol === symbol);
  if (!view) return {kind: 'expression', message: 'This presentation needs a preview of its content and owning state.'};
  if (view.inherits.some(type => ['UIViewRepresentable', 'UIViewControllerRepresentable'].includes(type))) {
    return {kind: 'native-bridge', message: 'This screen embeds a native controller. An explicit preview is needed to configure its content and device requirements.'};
  }
  if (view.generic) return {kind: 'generic-content', message: 'This reusable container needs concrete content views. Preview it through a configured parent or an explicit preview.'};
  if (!view.projectable) return {kind: 'view-body', message: 'Canvas cannot yet extract this view’s body automatically. An explicit preview can supply its rendered content.'};
  if (view.environment.length) return {kind: 'environment', message: `This screen needs an environment that Canvas could not construct: ${view.environment.map(value => value.type).join(', ')}.`};
  const calls = scan!.calls.filter(call => call.owner === symbol);
  const controller = calls.find(call => !call.inDestination && scans.some(scan => scan.declarations.some(child => child.name === call.name && child.inherits.includes('UIViewControllerRepresentable'))));
  if (controller) return {kind: 'native-bridge', message: 'This screen contains a native controller that needs a configured preview and device capabilities.'};
  if (view.requirements.some(input => !input.endsWith('?') && !/->\s*(?:Void|\(\))$/.test(input))) return {kind: 'inputs', message: 'Canvas could not connect all required inputs to an existing local example. Add an app preview or local sample state to render this destination.'};
  if (calls.some(call => call.name === 'task')) return {kind: 'lifecycle', message: 'This screen starts asynchronous work when opened. Canvas needs a configured local preview to supply its service or loading state.'};
  return {kind: 'composition', message: 'A child view needs configuration that Canvas cannot supply automatically. A configured parent or explicit preview can provide it.'};
}
