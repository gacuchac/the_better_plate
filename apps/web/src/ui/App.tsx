import { useEffect } from "react";
import { useApp } from "../store.tsx";
import { navigate, SyncChip, useRoute } from "./common.tsx";
import { RecipeEditor } from "./RecipeEditor.tsx";
import { Explore, Kitchen, You } from "./Screens.tsx";
import { SignIn } from "./SignIn.tsx";

const NAV = [
  { path: "/kitchen", label: "Your Kitchen", icon: "◎" },
  { path: "/create", label: "Create", icon: "+" },
  { path: "/explore", label: "Explore", icon: "⌕" },
  { path: "/you", label: "You", icon: "○" },
];

export function App() {
  const { account, accountChecked } = useApp();
  const route = useRoute();

  useEffect(() => {
    if (route === "/create") navigate(`/recipe/${crypto.randomUUID()}`);
  }, [route]);

  if (!account) {
    if (!accountChecked) return <p className="hint pad">Opening your kitchen…</p>;
    return <SignIn />;
  }

  const recipeMatch = /^\/recipe\/([0-9a-f-]{36})$/.exec(route);
  const section = recipeMatch ? "/kitchen" : route;
  let screen;
  if (recipeMatch) screen = <RecipeEditor key={recipeMatch[1]} id={recipeMatch[1]!} />;
  else if (route === "/explore") screen = <Explore />;
  else if (route === "/you") screen = <You />;
  else screen = <Kitchen />;

  return (
    <div className="shell">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <nav className="nav" aria-label="Main">
        <span className="brand" aria-hidden="true">
          The Better Plate
        </span>
        {NAV.map((n) => (
          <a key={n.path} href={`#${n.path}`} className="nav-item" aria-current={section === n.path ? "page" : undefined}>
            <span className="nav-icon" aria-hidden="true">
              {n.icon}
            </span>
            {n.label}
          </a>
        ))}
      </nav>
      <div className="content">
        <div className="topbar">
          {recipeMatch ? (
            <a className="back" href="#/kitchen">
              ‹ Recipes
            </a>
          ) : (
            <span />
          )}
          <SyncChip />
        </div>
        <main id="main">{screen}</main>
      </div>
    </div>
  );
}
