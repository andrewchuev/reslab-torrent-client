import { render } from "solid-js/web";
import App from "./App";
import "./index.css";

document.addEventListener("contextmenu", (e) => e.preventDefault());

render(() => <App />, document.getElementById("root")!);
