import { ArrowUpRight, Gamepad2, createIcons } from "lucide";
import "./home.css";
import { registerGameOfflineServiceWorker } from "./game-offline-cache.js";

createIcons({ icons: { ArrowUpRight, Gamepad2 } });
void registerGameOfflineServiceWorker();
