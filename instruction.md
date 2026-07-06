# Instruction

This document converts the reviewer comments from `high-resolution wind forecast and flight impact assessment_2026-07-06_00-55-43.pdf` into actionable implementation instructions for the dashboard.

## Functional Updates

1. Support `both directions` consistently across the dashboard.
2. If `both directions` is selected, ensure all calculations, summaries, tables, and charts include both arrivals and departures.
3. Update titles and labels when the dashboard is showing both directions so the wording matches the combined view.
4. Add a `next 30 hours` forecast option in addition to the existing horizons.
5. Include flights to and from other continents in the dashboard outputs.
6. Add a new row above `deep convection / bad weather status` and label it `TAF`.

## Time And Display

1. Show both local time and UTC (`Z`) time on the x-axis for easier operational reading.
2. Add more spacing between geographic categories to improve readability.
3. Preserve the current useful functionality while making the display clearer and more operationally friendly.

## Flight Logic And Methodology

1. Document how the number of `en route` flights is calculated.
2. Document how `within 100 km` flights are calculated.
3. The `within 100 km` estimate should focus on all en route flights within 100 km of Hong Kong because these are the most operationally vulnerable when bad weather affects HK.
4. Explain the criteria used to place flights into the table.
5. Add a short methodology note that explains how the table is generated.
6. Clarify whether flights shown as `on the ground from Greater China` are still at the origin airport or already counted as en route.

## Definitions To Standardize

1. Define the criteria for a `priority airport`.
2. Define the thresholds or rules behind weather severity labels such as `significant` and `severe`.
3. Confirm and document whether `Greater China` includes mainland China, Hong Kong, Macau, and Taiwan.

## Notes

1. Repeated reviewer questions about `priority airport` indicate that this definition should be visible in the UI or documentation, not only implicit in the code.
2. The original comments included positive feedback on the existing function, so the goal is to refine and clarify the dashboard rather than redesign it from scratch.
