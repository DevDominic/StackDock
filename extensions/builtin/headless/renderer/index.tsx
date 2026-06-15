import type { NativeExtension } from '../../../../src/extensions/extensionTypes';
import { headlessExtensionManifest } from '../manifest';
import { HeadlessPanel } from './HeadlessPanel';
import './headless.css';

export const headlessExtension: NativeExtension = {
  manifest: headlessExtensionManifest,
  renderView: (_contribution, ctx) => <HeadlessPanel runs={ctx.headlessRuns} onTerminate={ctx.headlessActions.terminate} onDelete={ctx.headlessActions.delete} />,
};
