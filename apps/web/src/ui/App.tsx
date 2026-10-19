import { useEffect } from "react";
import { trackRoute } from "../activity.ts";
import { useApp } from "../store.tsx";
import { navigate, SyncChip, useRoute } from "./common.tsx";
import { Cook } from "./Cook.tsx";
import { Icon, type IconName } from "./icons.tsx";
import { Meals } from "./Meals.tsx";
import { ReportIssue } from "./ReportIssue.tsx";
import { RecipeEditor } from "./RecipeEditor.tsx";
import { Explore, Kitchen, You } from "./Screens.tsx";
import { SharedRecipePage } from "./Share.tsx";
import { SignIn } from "./SignIn.tsx";

const NAV: { path: string; label: string; icon: IconName }[] = [
  { path: "/kitchen", label: "Kitchen", icon: "kitchen" },
  { path: "/create", label: "Create", icon: "plus" },
  { path: "/explore", label: "Explore", icon: "search" },
  { path: "/you", label: "You", icon: "user" },
];

export function App() {
  const { account, accountChecked } = useApp();
  const route = useRoute();

  useEffect(() => trackRoute(route), [route]);

  useEffect(() => {
    if (route === "/create") navigate(`/recipe/${crypto.randomUUID()}`);
  }, [route]);

  // Shared recipes open for anyone with the link, signed in or not.
  const sharedMatch = /^\/shared\/([^/]+)$/.exec(route);
  if (sharedMatch) {
    return (
      <>
        <SharedRecipePage key={sharedMatch[1]} shareId={sharedMatch[1]!} />
        <ReportIssue route="/shared" />
      </>
    );
  }

  if (!account) {
    if (!accountChecked) return <p className="hint pad">Opening your kitchen…</p>;
    return (
      <>
        <SignIn />
        <ReportIssue route="/sign-in" />
      </>
    );
  }

  const cookMatch = /^\/cook\/([0-9a-f-]{36})$/.exec(route);
  if (cookMatch) return <Cook key={cookMatch[1]} id={cookMatch[1]!} report={<ReportIssue route={route} className="report-btn icon-btn" />} />;

  const recipeMatch = /^\/recipe\/([0-9a-f-]{36})$/.exec(route);
  const mealsMatch = /^\/meals(?:\/(\d{4}-\d{2}-\d{2}))?$/.exec(route);
  const section = recipeMatch || mealsMatch ? "/kitchen" : route;
  let screen;
  if (recipeMatch) screen = <RecipeEditor key={recipeMatch[1]} id={recipeMatch[1]!} />;
  else if (mealsMatch) screen = <Meals date={mealsMatch[1]} />;
  else if (route === "/explore") screen = <Explore />;
  else if (route === "/you") screen = <You />;
  else screen = <Kitchen />;

  return (
    <div className={`shell${recipeMatch ? " has-action-bar" : ""}`}>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <nav className="nav" aria-label="Main">
        <span className="brand" aria-hidden="true">
          The Better Plate
        </span>
        {NAV.map((n) => (
          <a key={n.path} href={`#${n.path}`} className="nav-item" aria-current={section === n.path ? "page" : undefined}>
            <span className="nav-icon">
              <Icon name={n.icon} size={22} />
            </span>
            {n.label}
          </a>
        ))}
      </nav>
      <div className="content">
        <div className="topbar">
          {recipeMatch || mealsMatch ? (
            <a className="back" href="#/kitchen" aria-label="Back to Kitchen">
              <Icon name="back" /> Kitchen
            </a>
          ) : (
            <span />
          )}
          <SyncChip />
        </div>
        <main id="main">{screen}</main>
      </div>
      <ReportIssue route={route} />
    </div>
  );
}
