import * as SecureStore from "expo-secure-store";

const KEY = "gatehouse_token";
// Token lives in the OS keychain/keystore, never in AsyncStorage or SQLite.
export const getToken = () => SecureStore.getItemAsync(KEY);
export const setToken = (t: string) => SecureStore.setItemAsync(KEY, t);
export const clearToken = () => SecureStore.deleteItemAsync(KEY);
