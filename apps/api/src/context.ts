export interface AppEnv {
  Bindings: ApiBindings;
  Variables: { ownerId: string; displayName: string; isLocal: boolean; requestId: string };
}
