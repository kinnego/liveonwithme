'use client';
import { FormEvent, useEffect, useState } from 'react';
import { isSignInWithEmailLink, signInWithEmailLink } from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { useRouter } from 'next/navigation';

export const dynamic = 'force-dynamic';

const slugify=(s:string)=>s.toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');

export default function Claim({params}:{params:Promise<{id:string}>}){const [id,setId]=useState('');const [needsEmail,setNeedsEmail]=useState(false);const [status,setStatus]=useState<'checking'|'claiming'|'error'>('checking');const [error,setError]=useState('');const router=useRouter();

useEffect(()=>{params.then(p=>setId(p.id))},[params]);

async function finishClaim(referralId:string){setStatus('claiming');try{const u=auth.currentUser;if(!u)throw new Error('Sign-in did not complete.');const userSnap=await getDoc(doc(db,'users',u.uid));if(!userSnap.exists())await setDoc(doc(db,'users',u.uid),{uid:u.uid,email:u.email,role:'family',createdAt:serverTimestamp()});const refSnap=await getDoc(doc(db,'referrals',referralId));if(!refSnap.exists())throw new Error('This invite link is no longer valid.');const referral=refSnap.data();if(referral.status==='claimed'){if(referral.claimedByUid===u.uid&&referral.memorialId){router.push(`/memorial/${referral.memorialId}/manage`);return}throw new Error('This memorial has already been claimed.')}const slug=`${slugify(referral.deceasedFullName)}-${Math.random().toString(36).slice(2,7)}`;const batch=writeBatch(db);batch.set(doc(db,'memorials',slug),{ownerId:u.uid,slug,fullName:referral.deceasedFullName,nickname:referral.deceasedNickname||'',shortName:referral.deceasedShortName||'',address:referral.deceasedAddress||'',born:referral.deceasedBorn||'',died:referral.deceasedDied||'',epitaph:'',story:'',visibility:'unlisted',heroPhotoPath:'',createdAt:serverTimestamp(),updatedAt:serverTimestamp()});batch.update(doc(db,'referrals',referralId),{status:'claimed',claimedByUid:u.uid,memorialId:slug});await batch.commit();router.push(`/memorial/${slug}/manage`)}catch(err:any){setError(err.message);setStatus('error')}}

async function completeSignIn(email:string,referralId:string){try{await signInWithEmailLink(auth,email,window.location.href);window.localStorage.removeItem('emailForSignIn');await finishClaim(referralId)}catch(err:any){setError(err.message);setStatus('error')}}

useEffect(()=>{if(!id)return;if(!isSignInWithEmailLink(auth,window.location.href)){setError('This invite link isn’t valid or has expired. Please contact the funeral home for a new invite.');setStatus('error');return}const stored=window.localStorage.getItem('emailForSignIn');if(stored){completeSignIn(stored,id)}else{setNeedsEmail(true);setStatus('checking')}},[id]);

async function submitEmail(e:FormEvent<HTMLFormElement>){e.preventDefault();const fd=new FormData(e.currentTarget);const email=String(fd.get('email')).trim().toLowerCase();setNeedsEmail(false);await completeSignIn(email,id)}

if(status==='error')return <main className="shell"><div className="card"><h3>We couldn’t open this invite</h3><p className="muted">{error}</p></div></main>;
if(needsEmail)return <main className="shell"><div className="formCard"><div className="eyebrow">Confirm it’s you</div><h2>Confirm your email</h2><p className="muted">Enter the email address the invite was sent to.</p><form onSubmit={submitEmail}><label>Email</label><input name="email" type="email" required/><button className="button" style={{width:'100%',marginTop:24}}>Continue</button></form></div></main>;
return <main className="shell">Setting up the memorial page…</main>}
