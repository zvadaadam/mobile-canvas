import type { ReactNode } from 'react';
const unavailable = async () => { throw new Error('Convex is disconnected in Canvas design preview. Supply local query fixtures to explore remote records.'); };
const auth = { isLoading: false, isAuthenticated: false };
export class ConvexReactClient {
  constructor(..._args: unknown[]) {}
  close = async () => {};
  setAuth = () => {};
  clearAuth = () => {};
  query = unavailable;
  mutation = unavailable;
  action = unavailable;
}
const client = new ConvexReactClient();
export const ConvexProvider = ({ children }: { children: ReactNode }) => children;
export const ConvexProviderWithClerk = ConvexProvider;
export const ConvexProviderWithAuth = ConvexProvider;
export const Unauthenticated = ConvexProvider;
export const Authenticated = () => null;
export const AuthLoading = () => null;
export const useConvexAuth = () => auth;
export const useConvex = () => client;
// No records are invented. The app's loading/empty branches remain observable.
export const useQuery = () => undefined;
export const useMutation = () => unavailable;
export const useAction = () => unavailable;
