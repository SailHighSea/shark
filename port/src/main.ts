import "./style.css";
import { start } from "./app";

start().catch((e) => {
  document.body.textContent = `Shark failed to start: ${e}`;
});
