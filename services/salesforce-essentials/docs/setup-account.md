1. Go to [Salesforce Login Page](https://login.salesforce.com/) and sign up

2. Click the **Quick Settings** icon: <br/><br/>
   ![Quick Settings](assets/quick-settings.png) <br/><br/>

3. Click the **Open Advanced Setup** button

4. Navigate to **Platform Tools → Apps → App Manager**: <br/><br/>
   ![App Manager](assets/app-manager.png) <br/><br/>

5. In the top-right corner, click **New Connected App**

6. Choose: **Create a Connected App**

7. Enter the basic information: <br/><br/>
   ![Basic Information](assets/basic-information.png) <br/><br/>

8. Check: **Enable OAuth Settings**

9. Set redirect URI and scopes: <br/><br/>
   ![OAuth Settings](assets/oauth-settings.png) <br/><br/>

10. Uncheck: **Require Proof Key for Code Exchange (PKCE)**

11. Check:

    - **Enable Authorization Code and Credentials Flow**
    - **Enable Token Exchange Flow**
    - **Require Secret for Token Exchange Flow**
    - **Enable Refresh Token Rotation** <br/><br/>

    ![Toggle OAuth Settings](assets/toggle-oauth-settings.png) <br/><br/>

12. Save your changes

13. After saving, click **Manage Consumer Details**: <br/><br/>
    ![Consumer Details](assets/consumer-details.png) <br/><br/>

14. Enter the verification code

15. Copy: **Consumer Key** and **Consumer Secret**

16. Click the **Manage** button: <br/><br/>
    ![Manage](assets/manage.png) <br/><br/>

17. Click the **Edit Policies** button

18. Set the **Refresh Token Policy** to control when the refresh token should expire: <br/><br/>
    ![OAuth Policies](assets/oauth-policies.png) <br/><br/>

19. Save your changes

[Salesforce Official Docs](https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/intro_rest.htm)
