/** Grok's OpenID UserInfo subject is the immutable provider identity. */
export function grokAccountSubject(profile:{sub?:unknown}):string{
 const value=profile.sub;
 if((typeof value!=="string"&&typeof value!=="number")||!String(value).trim()||
    (typeof value==="number"&&!Number.isFinite(value)))throw Error("Grok UserInfo did not supply a valid immutable sub");
 return String(value);
}
