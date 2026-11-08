// share_price.rs: full multi-epoch scenario — 2 lenders, several top-ups,
// commission credited to the vote account between epochs, sweeps until debt 0.
// Asserts LP share price never decreases (Invariant 4) and lenders net positive.
mod common;
use common::*;

fn share_price(s: &LiteSVM, pool: &Pubkey, lp: &Pubkey) -> u128 {
    let supply = mint_supply(s, lp);
    if supply == 0 {
        return 1_000_000_000u128; // 1 lamport/share nominal
    }
    let pv = vault_available(s, pool) as u128 + pool_state(s).total_principal as u128;
    pv * 1_000_000_000 / supply as u128 // lamports per share, scaled
}

#[test]
fn share_price_never_decreases_full_scenario() {
    let mut s = svm();
    let admin = funded(&mut s, 10_000_000_000);
    init_pool(&mut s, &admin, Pubkey::new_unique());
    let (pool, _) = pool_pda();
    let (lp, _) = lp_pda(&pool);

    let l1 = funded(&mut s, 100_000_000_000);
    let l2 = funded(&mut s, 100_000_000_000);
    deposit(&mut s, &l1, 30_000_000_000);
    deposit(&mut s, &l2, 20_000_000_000);
    let ata1 = anchor_spl::associated_token::get_associated_token_address(&l1.pubkey(), &lp);
    let ata2 = anchor_spl::associated_token::get_associated_token_address(&l2.pubkey(), &lp);

    let node = funded(&mut s, 1_000_000_000);
    let keeper = funded(&mut s, 1_000_000_000);
    let vote = Pubkey::new_unique();
    let (auth, _) = auth_pda(&vote);
    let required = RENT_3762 + TICKET + BUFFER;
    put_vote_account(&mut s, &vote_cfg(vote, node.pubkey(), auth, required));
    enroll(&mut s, &node, &vote, Pubkey::new_unique()).unwrap();

    let mut last_price = share_price(&s, &pool, &lp);
    let mut epoch = 0u64;

    // 3 "dip" epochs: ticket burned, keeper tops up (debt grows)
    for _ in 0..3 {
        epoch += 1;
        set_epoch(&mut s, epoch);
        burn_ticket(&mut s, &vote, TICKET); // simulated VAT burn
        top_up(&mut s, &keeper, &vote).unwrap();
        let price = share_price(&s, &pool, &lp);
        assert!(price >= last_price, "price fell on top-up: {price} < {last_price}");
        last_price = price;
    }
    let pos = position_state(&s, &vote);
    assert_eq!(pos.topups, 3);

    // "recovery" epochs: commission > ticket, sweeps repay
    for _ in 0..8 {
        epoch += 1;
        set_epoch(&mut s, epoch);
        burn_ticket(&mut s, &vote, TICKET);
        credit_commission(&mut s, &vote, 1_200_000_000); // commission > ticket
        let r = sweep(&mut s, &keeper, &vote);
        if r.is_err() {
            break; // debt fully repaid, nothing left to sweep
        }
        let price = share_price(&s, &pool, &lp);
        assert!(price >= last_price, "price fell on sweep");
        last_price = price;
    }

    let pos = position_state(&s, &vote);
    assert_eq!(pos.principal, 0, "debt should be repaid by recovery commissions");
    assert_eq!(pos.fees, 0);
    assert!(pool_state(&s).total_fees_earned > 0, "pool should have earned fees");

    // both lenders withdraw everything -> net positive vs deposits
    let sh1 = token_balance(&s, &ata1);
    let sh2 = token_balance(&s, &ata2);
    let b1 = s.get_balance(&l1.pubkey()).unwrap();
    withdraw(&mut s, &l1, sh1).unwrap();
    let gain1 = s.get_balance(&l1.pubkey()).unwrap() - b1;
    let b2 = s.get_balance(&l2.pubkey()).unwrap();
    withdraw(&mut s, &l2, sh2).unwrap();
    let gain2 = s.get_balance(&l2.pubkey()).unwrap() - b2;

    // ~60% of earned fees, minus the withdraw tx fee
    let want = 30_000_000_000 + pool_state(&s).total_fees_earned * 3 / 5;
    assert!(gain1.abs_diff(want) <= 10_000, "lender A fee share: {gain1} vs {want}");
    assert!(gain1 > 30_000_000_000, "lender A net positive");
    assert!(gain2 > 20_000_000_000, "lender B net positive");
    // supply is now 0; pool has paid out everything except retained dust
    assert_eq!(mint_supply(&s, &lp), 0);
}
