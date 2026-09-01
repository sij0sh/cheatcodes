/**
 * Drives the choreograph workflow in a real SDK session. `pi -p` cannot run
 * this workflow: it disposes the session when the triggering turn ends, while
 * the engine still drives steps across turns. The SDK runtime stays alive and
 * rebinds extensions across the engine's session rollovers.
 */
export declare function main(argv?: string[]): Promise<void>;
