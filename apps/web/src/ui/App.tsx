import { useEffect } from "react";
import { trackRoute } from "../activity.ts";
import { useApp } from "../store.tsx";
import { navigate, StorageBanner, SyncChip, useRoute } from "./common.tsx";
import { Cook } from "./Cook.tsx";
import { Icon, type IconName } from "./icons.tsx";
import { Meals } from "./Meals.tsx";
import { ReportIssue } from "./ReportIssue.tsx";
import { RecipeEditor } from "./RecipeEditor.tsx";
import { Explore, Kitchen, You } from "./Screens.tsx";
import { PRIVACY_NOTICE } from "@betterplate/contracts";
import { ConsentScreen, PrivacyPage } from "./Privacy.tsx";
import { SharedRecipePage } from "./Share.tsx";
import { SignIn } from "./SignIn.tsx";
import { useT, type MessageKey } from "../i18n.ts";

const NAV: { path: string; label: MessageKey; icon: IconName }[] = [
  { path: "/kitchen", label: "nav.kitchen", icon: "kitchen" },
  { path: "/create", label: "nav.create", icon: "plus" },
  { path: "/explore", label: "nav.explore", icon: "search" },
  { path: "/you", label: "nav.you", icon: "user" },
];

export function App() {
  const { account, accountChecked } = useApp();
  const route = useRoute();
  const t = useT();

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

  if (route === "/privacy") {
    return (
      <>
        <PrivacyPage />
        <ReportIssue route="/privacy" />
      </>
    );
  }

  if (!account) {
    if (!accountChecked) return <p className="hint pad">{t("app.opening")}</p>;
    return (
      <>
        <SignIn />
        <ReportIssue route="/sign-in" />
      </>
    );
  }

  // Known to be behind the current notice (an account remembered offline without this info is not blocked).
  if (account.privacy && account.privacy.acceptedVersion !== PRIVACY_NOTICE.version) {
    return (
      <>
        <ConsentScreen />
        <ReportIssue route="/consent" />
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
        {t("app.skip")}
      </a>
      <nav className="nav" aria-label={t("nav.main")}>
        <span className="brand" aria-hidden="true">
          The Better Plate
        </span>
        {NAV.map((n) => (
          <a key={n.path} href={`#${n.path}`} className="nav-item" aria-current={section === n.path ? "page" : undefined}>
            <span className="nav-icon">
              <Icon name={n.icon} size={22} />
            </span>
            {t(n.label)}
          </a>
        ))}
      </nav>
      <div className="content">
        <div className="topbar">
          {recipeMatch || mealsMatch ? (
            <a className="back" href="#/kitchen" aria-label={t("nav.backToKitchen")}>
              <Icon name="back" /> {t("nav.kitchen")}
            </a>
          ) : (
            <span />
          )}
          <SyncChip />
        </div>
        <StorageBanner />
        <main id="main">{screen}</main>
      </div>
      <ReportIssue route={route} />
    </div>
  );
}
