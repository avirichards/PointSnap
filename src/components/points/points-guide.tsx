"use client";
import { useState } from "react";
import { ChevronRight, ArrowRight } from "lucide-react";
import { TRANSFER_RULES, transferEstimate } from "@/lib/transfer-planner";
import {
  CURRENCIES,
  availableWalletBalance,
  type WalletData,
} from "@/lib/wallet";
import { useSessionPoints } from "@/hooks/use-session-points";
import { programName } from "@/lib/programs";
import { pointsForParty } from "@/lib/award-search/value";
import type { AwardResult, AwardPrice } from "@/lib/award-search/types";
const n = (value: number) => value.toLocaleString("en-US");
export function PointsGuide({
  row,
  price,
  pax,
  wallet,
}: {
  row: AwardResult;
  price: AwardPrice;
  pax: number;
  wallet: WalletData | null;
}) {
  const session = useSessionPoints();
  const rules = TRANSFER_RULES.filter((r) => r.program === row.programId);
  const [bank, setBank] = useState(rules[0]?.bank ?? ""),
    [region, setRegion] = useState("US"),
    [eligible, setEligible] = useState(false),
    [airline, setAirline] = useState<string | null>(null),
    [source, setSource] = useState<string | null>(null);
  const own = (asset: string) =>
    session.balances[asset] ?? availableWalletBalance(wallet, asset);
  const airlineInput = airline ?? String(own(row.programId) ?? 0),
    bankInput = source ?? (own(bank) === undefined ? "" : String(own(bank)));
  const needed = pointsForParty(price, pax),
    airlineBalance = Number(airlineInput),
    bankBalance = Number(bankInput),
    rule = rules.find((r) => r.bank === bank);
  const estimate =
    rule && region === "US" && bankInput !== "" && airlineInput !== ""
      ? transferEstimate(rule, needed, airlineBalance, bankBalance)
      : null;
  return (
    <details className="points-guide">
      <summary>
        <ChevronRight className="size-4" />
        Can I book this with my points?
      </summary>
      <div className="space-y-4 mt-4">
        <p className="text-sm leading-relaxed">
          You book this flight through{" "}
          <strong>{programName(row.programId)}</strong>, even if another airline
          operates it. You need {n(needed)} program points for {pax} traveler
          {pax > 1 ? "s" : ""}, plus the displayed fees.
        </p>
        <label className="trip-label">
          {programName(row.programId)} balance
          <input
            type="number"
            inputMode="numeric"
            min="0"
            max="2000000000"
            step="1"
            value={airlineInput}
            onChange={(e) => setAirline(e.target.value)}
          />
        </label>
        {airlineInput !== "" &&
        Number.isSafeInteger(airlineBalance) &&
        airlineBalance >= needed ? (
          <div className="points-answer">
            <strong>Your entered balance covers the points.</strong>
            <p>
              Confirm the fare, seats and any account eligibility with{" "}
              {programName(row.programId)}. You still need to pay the fees.
            </p>
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {Number.isSafeInteger(airlineBalance) &&
              airlineBalance >= 0 &&
              airlineInput !== ""
                ? `${n(Math.max(0, needed - airlineBalance))} more program points needed.`
                : "Enter a whole-number balance."}
            </p>
            {rules.length > 0 ? (
              <>
                <label className="trip-label">
                  Where was your card issued?
                  <select
                    value={region}
                    onChange={(e) => {
                      setRegion(e.target.value);
                      setEligible(false);
                    }}
                  >
                    <option value="US">United States</option>
                    <option value="other">Another country</option>
                  </select>
                </label>
                {region === "US" ? (
                  <>
                    <label className="trip-label">
                      Use points from
                      <select
                        value={bank}
                        onChange={(e) => {
                          setBank(e.target.value);
                          setSource(null);
                          setEligible(false);
                        }}
                      >
                        {rules.map((r) => (
                          <option key={r.bank} value={r.bank}>
                            {CURRENCIES.find((c) => c.id === r.bank)?.name ??
                              r.bank}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="trip-label">
                      Your available bank points
                      <input
                        type="number"
                        inputMode="numeric"
                        min="0"
                        max="2000000000"
                        step="1"
                        placeholder="Enter a balance"
                        value={bankInput}
                        onChange={(e) => setSource(e.target.value)}
                      />
                    </label>
                    {rule && (
                      <>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          {rule.eligibility}
                        </p>
                        <label className="flex items-start gap-2 text-xs leading-relaxed">
                          <input
                            className="mt-1"
                            type="checkbox"
                            checked={eligible}
                            onChange={(e) => setEligible(e.target.checked)}
                          />
                          My card and loyalty account meet these requirements.
                        </label>
                      </>
                    )}
                    {estimate && (
                      <div className="points-answer">
                        <p className="text-xs">
                          Planning estimate · standard rate, no bonus
                        </p>
                        <strong>
                          {n(estimate.transfer)} bank points{" "}
                          <ArrowRight className="inline size-3" />{" "}
                          {n(estimate.received)} program points
                        </strong>
                        <p>
                          {estimate.overMaximum
                            ? "This exceeds the reviewed per-transfer maximum. Check the provider's current limits."
                            : !eligible
                              ? "Confirm your account eligibility to use this estimate."
                              : estimate.shortfall
                                ? `${n(estimate.shortfall)} more bank points needed with this option.`
                                : "Your entered balance covers this estimated transfer."}
                        </p>
                        {estimate.leftover > 0 && (
                          <p>
                            {n(estimate.leftover)} program points would remain
                            after this award.
                          </p>
                        )}
                        {estimate.fee !== null && (
                          <p>
                            Estimated transfer fee: ${estimate.fee.toFixed(2)}{" "}
                            USD, in addition to award fees.
                          </p>
                        )}
                        {rule?.rounding === "planning" && (
                          <p>
                            Rounded up in {n(rule.increment)}-point planning
                            blocks. Confirm the exact minimum, increment and
                            maximum in your account.
                          </p>
                        )}
                      </div>
                    )}
                    {bankInput !== "" && rule && !estimate && (
                      <p className="text-sm text-muted-foreground">
                        A current calculation is unavailable. Check balances and
                        the provider’s current transfer rules.
                      </p>
                    )}
                    {rule && (
                      <>
                        <p className="text-xs text-muted-foreground">
                          {rule.timing} Transfers are final. Availability can
                          change while points are moving.
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Reviewed {rule.checked} ·{" "}
                          {rule.sources.map((url, i) => (
                            <span key={url}>
                              {i > 0 ? " · " : ""}
                              <a
                                href={url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="underline"
                              >
                                {i === 0 ? "Provider rules" : `Source ${i + 1}`}
                              </a>
                            </span>
                          ))}
                        </p>
                      </>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Rules differ by country. This calculator currently covers
                    reviewed US transfer routes; check your local issuer for
                    your rate and eligibility.
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                We haven’t verified a direct bank transfer route for this
                program. Compare another booking program for this same flight,
                or use points already held here.
              </p>
            )}
          </>
        )}
        <ol className="booking-steps">
          <li>
            <span>1</span>
            <div>
              <strong>Confirm the award first.</strong>
              <p>
                Open the airline, match these flights and the fare, and check
                the full price and conditions.
              </p>
            </div>
          </li>
          <li>
            <span>2</span>
            <div>
              <strong>Move points only if needed.</strong>
              <p>
                Check the current rate, any offer, transfer limits and delivery
                time in your bank account.
              </p>
            </div>
          </li>
          <li>
            <span>3</span>
            <div>
              <strong>Return to the program to book.</strong>
              <p>
                Wait for the points to arrive, then complete the booking with
                the airline.
              </p>
            </div>
          </li>
        </ol>
      </div>
    </details>
  );
}
