// sim.rs (feature demo-sim): PDA-signed Withdraw(ticket) vote -> incinerator,
// respecting the rent+pending floor. Invariant 2 (sim branch).
#![cfg(feature = "demo-sim")]
mod common;
use common::*;

fn setup_enrolled(lamports: u64) -> (LiteSVM, Keypair, Keypair, Pubkey) {
    let mut s = svm();
    let admin = funded(&mut s, 10_000_000_000);
    init_pool(&mut s, &admin, Pubkey::new_unique());
    let node = funded(&mut s, 1_000_000_000);
    let keeper = funded(&mut s, 1_000_000_000);
    let vote = Pubkey::new_unique();
    let (auth, _) = auth_pda(&vote);
    put_vote_account(&mut s, &vote_cfg(vote, node.pubkey(), auth, lamports));
    enroll(&mut s, &node, &vote, Pubkey::new_unique()).unwrap();
    (s, node, keeper, vote)
}

fn sim_burn(s: &mut LiteSVM, payer: &Keypair, vote: &Pubkey) -> Result<(), String> {
    let (pool, _) = pool_pda();
    let (pos, _) = pos_pda(vote);
    let (auth, _) = auth_pda(vote);
    let ix = anchor_lang::solana_program::instruction::Instruction::new_with_bytes(
        ticketline::id(),
        &ticketline::instruction::SimTicketBurn {}.data(),
        ticketline::accounts::SimTicketBurnIx {
            payer: payer.pubkey(),
            pool,
            position: pos,
            vote_account: *vote,
            auth,
            incinerator: INCINERATOR,
            vote_program: VOTE_PROGRAM_ID,
            rent: RENT_SYSVAR,
        }
        .to_account_metas(None),
    );
    send(s, &[payer], ix)
}

#[test]
fn sim_ticket_burn_respects_floor() {
    let required = RENT_3762 + TICKET + BUFFER;
    let (mut s, _n, keeper, vote) = setup_enrolled(required + 2 * TICKET);
    sim_burn(&mut s, &keeper, &vote).unwrap();
    assert_eq!(vote_lamports(&s, &vote), required + TICKET);
    assert!(s.get_balance(&INCINERATOR).unwrap() >= TICKET);
    // burn again leaves exactly required
    sim_burn(&mut s, &keeper, &vote).unwrap();
    assert_eq!(vote_lamports(&s, &vote), required);
    // floor is rent+pending (buffer is not part of the sim floor):
    // burns continue until remaining < rent+pending+ticket
    sim_burn(&mut s, &keeper, &vote).unwrap(); // leaves rent+buffer
    let r = sim_burn(&mut s, &keeper, &vote);
    assert!(r.is_err(), "burn below rent+pending must fail");
    assert!(vote_lamports(&s, &vote) >= RENT_3762);
}
