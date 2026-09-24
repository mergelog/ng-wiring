// The module this imports does not exist in the workspace.
import { helper } from './not-there';

export const use = (): unknown => helper();
