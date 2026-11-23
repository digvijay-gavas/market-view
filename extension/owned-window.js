export async function closeOwnedWindow(chromeApi,runner){
 // Chrome closes a window when its last tab is removed. Removing only our tab
 // also preserves a person adding or moving tabs during cleanup.
 await chromeApi.tabs.remove(runner.id);
}
