import { useState } from "react";
import { router } from "expo-router";
import { errorMessage } from "../../api/client";
import { useCoverageMap, useCoverageSearch } from "../../api/hooks";
import { Body, Button, ErrorView, Field, Loading, Screen, Title } from "../../ui";
import { CoverageCard } from "../../ui/CoverageCard";

export default function Benefits() {
  const [q, setQ] = useState("");
  const search = useCoverageSearch(q);
  const map = useCoverageMap();
  const searching = q.trim().length >= 2;

  return (
    <Screen>
      <Title sub="מידע על הכיסויים שלכם. לא המלצה לקנות או לבטל ביטוח">מה מגיע לי על...?</Title>
      <Field label="חיפוש" value={q} onChangeText={setQ} placeholder="פסיכולוג, פיזיו, MRI, משקפיים..." />
      {searching ? (
        <>
          {search.isLoading ? <Loading /> : null}
          {search.data && search.data.items.length === 0 ? (
            <Body muted>
              {search.data.categories.length > 0
                ? `לא מצאנו כיסוי ל${search.data.categories[0]!.label} בביטוחים שהגדרתם.`
                : "לא זיהינו את סוג השירות. נסו מילה אחרת."}
            </Body>
          ) : null}
          {search.data?.items.map((item) => <CoverageCard key={item.category} item={item} />)}
        </>
      ) : (
        <>
          {map.isLoading ? <Loading /> : null}
          {map.error ? <ErrorView message={errorMessage(map.error)} onRetry={() => void map.refetch()} /> : null}
          {map.data?.map((item) => <CoverageCard key={item.category} item={item} />)}
          {map.data?.length === 0 ? (
            <>
              <Body muted>עוד לא הגדרתם ביטוחים.</Body>
              <Button title="הגדרת ביטוחים" variant="secondary" onPress={() => router.push("/household")} />
            </>
          ) : null}
        </>
      )}
    </Screen>
  );
}
