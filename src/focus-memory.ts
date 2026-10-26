// Bases re-renders a view whenever any note in it changes, which rebuilds the inspector's inputs.
// FocusMemory remembers the field being edited (and text not yet committed) so a re-render can put
// the cursor back, and forgets it once the user leaves the inspector so focus is never stolen later.

export interface FocusSnapshot {
	key: string;
	value: string;
	dirty: boolean;
	start: number | null;
	end: number | null;
}

export interface FocusOutContext {
	/** False when the input was removed by a re-render rather than blurred by the user. */
	inputConnected: boolean;
	/** True when focus moved to another element inside the same inspector. */
	focusInInspector: boolean;
}

interface FocusState extends FocusSnapshot {
	token: object;
}

export class FocusMemory {
	private state: FocusState | null = null;

	/** Returns a token identifying this focus, for the matching focusOut. */
	focusIn(key: string, value: string): object {
		if (this.state?.key === key) return this.state.token;
		this.state = { key, value, dirty: false, start: null, end: null, token: {} };
		return this.state.token;
	}

	input(key: string, value: string, start: number | null, end: number | null): void {
		if (this.state?.key !== key) return;
		Object.assign(this.state, { value, dirty: true, start, end });
	}

	committed(key: string, value: string): void {
		if (this.state?.key !== key) return;
		Object.assign(this.state, { value, dirty: false, start: null, end: null });
	}

	focusOut(token: object, context: FocusOutContext): void {
		if (this.state?.token !== token) return;
		if (!context.inputConnected) return;
		if (!context.focusInInspector) this.state = null;
	}

	restore(): FocusSnapshot | null {
		if (!this.state) return null;
		const { key, value, dirty, start, end } = this.state;
		return { key, value, dirty, start, end };
	}

	clear(): void {
		this.state = null;
	}
}
