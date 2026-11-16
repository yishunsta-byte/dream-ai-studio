// Whether a restore ticket can be confirmed again after a failed finish. Decided from the ticket's
// actual server state, never from the error code alone (T-041):
// - failed / missing: the server already removed staging; only a new inspection can continue.
// - prepared / completed: replay with the same ticket is authenticated and idempotent.
// - ready / finishing: not claimed or still owned by another request; the same ticket re-checks safely.
// - unknown: the state could not be read (e.g. network or startup); keep the ticket rather than lose a prepared one.
export const restoreTicketStates=["ready","finishing","prepared","completed","failed","missing","unknown"] as const;
export type RestoreTicketState=typeof restoreTicketStates[number];
export function canRetrySameTicket(state:RestoreTicketState){return state!=="failed"&&state!=="missing";}
